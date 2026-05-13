import { fromMarkdown } from 'mdast-util-from-markdown'

// --- 目标结构类型（与 summary.md 约定一致）---
/** 单个关联组件 */
export type SummaryRelation = { type: string; name: string }
/** 单个事件处理器：handlerName、标题、mermaid 流程图、可选关联组件 */
export type SummaryEventHandler = { handler: string; title: string; mermaid: string; relations?: SummaryRelation[] }
/** 单个事件：组件id、处理器列表 */
export type SummaryEvent = { id: string; handlers: SummaryEventHandler[] }
/** 单个数据源：顶层key（root或组件id）-> API名 -> { desc } */
export type SummaryDatasource = Record<string, Record<string, { desc?: string }>>
/** 单个store项：path、field、desc */
export type SummaryStoreItem = {
  path: string;
  field: string;
  desc?: string;
}

/** 单个store分组：组名 -> 项列表 */
export type SummaryStoreGroup = Record<string, SummaryStoreItem[]>

/** 单个区块：标题、摘要、类型，以及可选的 events 列表、datasource 列表和 store 信息 */
export type SummaryBlock = {
  title?: string
  summary?: string
  type?: string
  events?: SummaryEvent[]
  datasource?: SummaryDatasource
  store?: SummaryStoreGroup
  children?: Record<string, SummaryBlock>
}
/** 解析结果：区块名 -> 区块数据 */
export type ParsedSummary = Record<string, SummaryBlock>

type AstNode = { type: string; value?: string; children?: AstNode[]; depth?: number }

/**
 * 从 mdast 节点及其子节点中递归提取纯文本
 */
function getNodeText(node: AstNode): string {
  if (node.type === 'text' && typeof node.value === 'string') return node.value
  if (Array.isArray(node.children)) return node.children.map(getNodeText).join('')
  return ''
}

/**
 * 从 listItem 的第一个 paragraph 中提取文本
 */
function getListItemText(item: AstNode): string {
  const first = item.children?.[0]
  return first ? getNodeText(first) : ''
}

/**
 * 从 listItem 的子节点中找到嵌套 list
 */
function getNestedList(item: AstNode): AstNode | undefined {
  return item.children?.find(c => c.type === 'list')
}

/**
 * 解析 relations 列表节点。
 * 每个 listItem 的首行文本为关联组件名，嵌套 list 为属性（如 type: popup）。
 * 示例：
 *   - MessageDetailModal
 *     - type: popup
 */
function parseRelations(listNode: AstNode): SummaryRelation[] {
  const relations: SummaryRelation[] = []
  for (const item of listNode.children ?? []) {
    if (item.type !== 'listItem') continue
    const nameText = getListItemText(item).trim()
    const name = nameText.endsWith(':') ? nameText.slice(0, -1).trim() : nameText
    if (!name) continue

    let type = ''
    const propsList = getNestedList(item)
    if (propsList) {
      for (const propItem of propsList.children ?? []) {
        if (propItem.type !== 'listItem') continue
        const text = getListItemText(propItem)
        const colonIdx = text.indexOf(':')
        if (colonIdx === -1) continue
        const key = text.slice(0, colonIdx).trim()
        const value = text.slice(colonIdx + 1).trim()
        if (key === 'type') type = value
      }
    }

    relations.push({ type, name })
  }
  return relations
}

/**
 * 解析 store 的 listItem。
 * AST 结构（四层嵌套）：
 *   listItem (paragraph → "store:")
 *     list
 *       listItem           ← 分组名 (如 statData)
 *         paragraph → "statData"   （无冒号）
 *         list
 *           listItem       ← path 项（纯文本路径，无 key）
 *             paragraph → "/pages/HomePage/store.js"
 *             list
 *               listItem → "field: studentCount"
 *               listItem → "desc: 展示学生总数"
 */
function parseStoreItem(item: AstNode): SummaryStoreGroup {
  const storeGroup: SummaryStoreGroup = {}
  const storeNestedList = getNestedList(item)
  if (!storeNestedList) return storeGroup

  // 第一层：遍历分组名
  for (const groupItem of storeNestedList.children ?? []) {
    if (groupItem.type !== 'listItem') continue
    const groupNameText = getListItemText(groupItem).trim()
    const groupName = groupNameText.endsWith(':') ? groupNameText.slice(0, -1).trim() : groupNameText
    if (!groupName) continue

    const itemsList = getNestedList(groupItem)
    if (!itemsList) {
      storeGroup[groupName] = []
      continue
    }

    const items: SummaryStoreItem[] = []

    // 第二层：遍历 path 项（纯文本路径，无 key）
    for (const pathItem of itemsList.children ?? []) {
      if (pathItem.type !== 'listItem') continue
      const pathText = getListItemText(pathItem).trim()
      // 路径是纯文本，无冒号（可能以 / 开头，也可能不带）
      // 如果包含冒号则说明不是路径项，跳过
      if (pathText.includes(':')) continue
      if (!pathText) continue
      const pathValue = pathText

      const fieldList = getNestedList(pathItem)
      if (!fieldList) {
        items.push({ path: pathValue, field: '' })
        continue
      }

      let field = ''
      let desc: string | undefined

      // 第三层：遍历属性（field/desc 为 key-value 形式）
      for (const fieldItem of fieldList.children ?? []) {
        if (fieldItem.type !== 'listItem') continue
        const text = getListItemText(fieldItem)
        const fieldColonIdx = text.indexOf(':')
        if (fieldColonIdx === -1) continue
        const fieldKey = text.slice(0, fieldColonIdx).trim()
        const fieldValue = text.slice(fieldColonIdx + 1).trim()
        if (fieldKey === 'field') field = fieldValue
        else if (fieldKey === 'desc') desc = fieldValue
      }

      items.push({ path: pathValue, field, desc })
    }

    storeGroup[groupName] = items
  }

  return storeGroup
}

/**
 * 解析单个 handler 属性列表（title/mermaid/relation）。
 * AST 结构：
 *   list
 *     listItem → "title: 打开弹窗"
 *     listItem → "mermaid: flowchart LR; ..."
 *     listItem (paragraph → "relation:")
 *       list
 *         listItem → "type: popup"
 *         listItem → "name: ConfirmModal"
 */
function parseHandlerProps(propsListNode: AstNode): { title: string; mermaid: string; relations?: SummaryRelation[] } {
  let title = ''
  let mermaid = ''
  let relations: SummaryRelation[] | undefined

  for (const propItem of propsListNode.children ?? []) {
    if (propItem.type !== 'listItem') continue
    const text = getListItemText(propItem)

    if (text === 'relations:') {
      const relList = getNestedList(propItem)
      if (relList) {
        const parsed = parseRelations(relList)
        if (parsed.length > 0) relations = parsed
      }
      continue
    }

    const colonIdx = text.indexOf(':')
    if (colonIdx === -1) continue
    const key = text.slice(0, colonIdx).trim()
    const value = text.slice(colonIdx + 1).trim()
    if (key === 'title') title = value
    else if (key === 'mermaid') mermaid = value
  }

  return { title, mermaid, relations }
}

/**
 * 解析 events 的 listItem。
 * AST 结构（三层嵌套）：
 *   listItem (paragraph → "events:")
 *     list
 *       listItem           ← 组件 id（如 searchInput）
 *         paragraph → "searchInput"
 *         list
 *           listItem       ← 事件处理器名（如 onChange）
 *             paragraph → "onChange"
 *             list
 *               listItem → "title: 输入搜索关键词"
 *               listItem → "mermaid: flowchart LR; ..."
 *               listItem (paragraph → "relation:")
 *                 list
 *                   listItem → "type: popup"
 *                   listItem → "name: ConfirmModal"
 */
function parseEventsItem(item: AstNode): SummaryEvent[] {
  const events: SummaryEvent[] = []
  const eventsNestedList = getNestedList(item)
  if (!eventsNestedList) return events

  for (const evItem of eventsNestedList.children ?? []) {
    if (evItem.type !== 'listItem') continue
    const idText = getListItemText(evItem).trim()
    const id = idText.endsWith(':') ? idText.slice(0, -1).trim() : idText
    if (!id) continue

    const handlersListNode = getNestedList(evItem)
    if (!handlersListNode) {
      events.push({ id, handlers: [] })
      continue
    }

    const handlers: SummaryEventHandler[] = []

    for (const handlerItem of handlersListNode.children ?? []) {
      if (handlerItem.type !== 'listItem') continue
      const handlerText = getListItemText(handlerItem).trim()
      const handler = handlerText.endsWith(':') ? handlerText.slice(0, -1).trim() : handlerText
      if (!handler) continue

      const propsListNode = getNestedList(handlerItem)
      if (!propsListNode) {
        handlers.push({ handler, title: '', mermaid: '' })
        continue
      }

      const { title, mermaid, relations } = parseHandlerProps(propsListNode)
      const h: SummaryEventHandler = { handler, title, mermaid }
      if (relations && relations.length > 0) h.relations = relations
      handlers.push(h)
    }

    events.push({ id, handlers })
  }

  return events
}

/**
 * 解析 datasource 的 listItem。
 * AST 结构（四层嵌套）：
 *   listItem (paragraph → "datasource:")
 *     list
 *       listItem           ← "root"（分组名）
 *         paragraph → "root"   （无冒号）
 *         list
 *           listItem       ← API 名称（如 getStudentDetail）
 *             paragraph → "getStudentDetail"   （无冒号）
 *             list
 *               listItem → "desc: 页面初始化时调用接口获取学生详情"
 */
function parseDatasourceItem(item: AstNode): SummaryDatasource | undefined {
  const dsNestedList = getNestedList(item)
  if (!dsNestedList) return undefined

  const result: SummaryDatasource = {}

  // 遍历所有顶层 key（root、组件id 等）
  for (const dsItem of dsNestedList.children ?? []) {
    if (dsItem.type !== 'listItem') continue
    const keyText = getListItemText(dsItem).trim()
    const key = keyText.endsWith(':') ? keyText.slice(0, -1).trim() : keyText
    if (!key) continue

    const apiList = getNestedList(dsItem)
    if (!apiList) {
      result[key] = {}
      continue
    }

    const apis: Record<string, { desc?: string }> = {}

    // 遍历 API 项（第三层）
    for (const apiItem of apiList.children ?? []) {
      if (apiItem.type !== 'listItem') continue
      const apiNameText = getListItemText(apiItem).trim()
      const apiName = apiNameText.endsWith(':') ? apiNameText.slice(0, -1).trim() : apiNameText
      if (!apiName) continue

      const propsList = getNestedList(apiItem)
      let desc: string | undefined

      // 遍历属性（第四层）
      if (propsList) {
        for (const propItem of propsList.children ?? []) {
          if (propItem.type !== 'listItem') continue
          const text = getListItemText(propItem)
          const colonIdx = text.indexOf(':')
          if (colonIdx === -1) continue
          const propKey = text.slice(0, colonIdx).trim()
          const propValue = text.slice(colonIdx + 1).trim()
          if (propKey === 'desc') desc = propValue
        }
      }

      apis[apiName] = { desc }
    }

    result[key] = apis
  }

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * 将 summary.md 解析为结构化数据。
 * 约定：根节点 children 顺序为 [heading, list?, thematicBreak?]*；
 * - heading：当前区块 key（# 或 ## 或 ### 的文本）
 * - list：紧接在该 heading 后的属性列表
 * - thematicBreak（---）：仅作分隔
 */
const parsemd = (md: string): ParsedSummary => {
  const ast = fromMarkdown(md)
  const result: ParsedSummary = {}
  const astChildren = (ast as unknown as AstNode).children ?? []

  /** Stack tracks { depth, block } so we always have a direct reference to the current block */
  const stack: { depth: number; block: SummaryBlock }[] = []

  const getCurrentBlock = (): SummaryBlock | null =>
    stack.length > 0 ? stack[stack.length - 1].block : null

  for (const node of astChildren) {
    if (node.type === 'heading') {
      const headingText = getNodeText(node)
      const depth = node.depth ?? 1

      // Pop entries whose depth >= current depth (they are no longer ancestors)
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop()
      }

      let newBlock: SummaryBlock
      if (stack.length === 0) {
        // No parent: top-level entry in result
        if (!result[headingText]) result[headingText] = {}
        newBlock = result[headingText]
      } else {
        // Has parent: insert into parent's children
        const parentBlock = stack[stack.length - 1].block
        if (!parentBlock.children) parentBlock.children = {}
        if (!parentBlock.children[headingText]) parentBlock.children[headingText] = {}
        newBlock = parentBlock.children[headingText]
      }

      stack.push({ depth, block: newBlock })
      continue
    }

    if (node.type === 'thematicBreak') continue

    if (node.type === 'list') {
      const block = getCurrentBlock()
      if (!block) continue

      for (const item of node.children ?? []) {
        if (item.type !== 'listItem') continue
        const lineText = getListItemText(item)

        if (lineText === 'events:') {
          block.events = parseEventsItem(item)
          continue
        }

        if (lineText === 'datasource:') {
          const ds = parseDatasourceItem(item)
          if (ds) block.datasource = ds
          continue
        }

        if (lineText === 'store:') {
          block.store = parseStoreItem(item)
          continue
        }

        const colonIdx = lineText.indexOf(':')
        if (colonIdx !== -1) {
          const key = lineText.slice(0, colonIdx).trim()
          const value = lineText.slice(colonIdx + 1).trim()
          if (key && (block as Record<string, unknown>)[key] === undefined) {
            (block as Record<string, unknown>)[key] = value
          }
        }
      }
    }
  }

  return result
}

export { parsemd }

// ─── requirement.md parser ────────────────────────────────────────────────────

/** requirement.md 解析结果 */
export type ParsedRequirement = {
  /** YAML front matter 中的 title */
  title?: string
  /** YAML front matter 中的 desc */
  desc?: string
  /**
   * 预处理后的 markdown 正文（已去除 front matter）：
   * 1. flowchart/graph 裸行 → mermaid fenced 代码块
   * 2. ## 标题或整行 **粗体标题** 后的 type/related/rank 裸行 → HTML 标签行；无自带序号的标题仅按功能点条数编号
   */
  body: string
}

const META_TYPE_LABEL: Record<string, string> = { new: '新需求', edit: '变更需求' }

/** 优先级 → 颜色映射（P0 红、P1 橙、P2 蓝灰，其余默认灰） */
const rankColor = (rank: string): { bg: string; color: string; border: string } => {
  const r = rank.toUpperCase()
  if (r === 'P0') return { bg: '#fff1f0', color: '#cf1322', border: '1px solid #ffa39e' }
  if (r === 'P1') return { bg: '#fff7e6', color: '#d46b08', border: '1px solid #ffd591' }
  if (r === 'P2') return { bg: '#f0f5ff', color: '#2f54eb', border: '1px solid #adc6ff' }
  return {
    bg: 'var(--mybricks-bg-color-hover)',
    color: 'var(--mybricks-text-color-sub)',
    border: '1px solid var(--mybricks-border-color-main)',
  }
}

/**
 * 将 ## 标题 + meta（type/rank/related）渲染为 HTML：
 * - 仅当本标题为功能点（带 type/related/rank 之一）且标题自身无序号时，在左侧加「功能点序号」
 * - 标题行：序号 + 标题文字，右侧依次 [rank标签] [type标签]
 * - related 另起一行，前缀「关联UI：」
 */
const renderHeadingWithMeta = (
  headingText: string,
  featureOrdinal: number | null,
  type?: string,
  related?: string,
  rank?: string,
): string => {
  const hasIndex = /^[\d一二三四五六七八九十]/.test(headingText)
  const displayTitle =
    hasIndex ? headingText : featureOrdinal != null ? `${featureOrdinal}. ${headingText}` : headingText

  // rank 标签
  let rankHtml = ''
  if (rank) {
    const { bg, color, border } = rankColor(rank)
    rankHtml =
      `<span style="display:inline-flex;align-items:center;padding:0 6px;height:19px;border-radius:4px;` +
      `font-size:11px;font-weight:600;background:${bg};color:${color};border:${border};` +
      `flex-shrink:0;vertical-align:middle;margin-left:6px">${rank}</span>`
  }

  // type 标签（新需求/变更需求，放标题右侧）
  let typeHtml = ''
  if (type) {
    const label = META_TYPE_LABEL[type] ?? type
    const isNew = type === 'new'
    const bg = isNew
      ? 'var(--mybricks-color-primary,#1677ff)'
      : 'color-mix(in srgb,var(--mybricks-color-primary,#1677ff) 15%,transparent)'
    const color = isNew ? '#fff' : 'var(--mybricks-color-primary,#1677ff)'
    const border = isNew
      ? 'none'
      : '1px solid color-mix(in srgb,var(--mybricks-color-primary,#1677ff) 35%,transparent)'
    typeHtml =
      `<span style="display:inline-flex;align-items:center;padding:0 7px;height:19px;border-radius:4px;` +
      `font-size:11px;font-weight:600;background:${bg};color:${color};border:${border};` +
      `flex-shrink:0;vertical-align:middle;margin-left:6px">${label}</span>`
  }

  // 标题行：标题文字在左，rank + type 在右
  const titleLine =
    `<h3 style="display:flex;align-items:center;margin:16px 0 4px;font-size:14px;font-weight:600;` +
    `color:var(--mybricks-text-color-main)">` +
    `<span>${displayTitle}</span>` +
    rankHtml +
    typeHtml +
    `</h3>`

  // related 行（另起一行，加前缀）
  let relatedLine = ''
  if (related) {
    const tags = related.split(',').map(s => s.trim()).filter(Boolean).map(name =>
      `<span style="display:inline-flex;align-items:center;padding:0 6px;height:18px;border-radius:3px;` +
      `font-size:11px;background:var(--mybricks-bg-color-hover);color:var(--mybricks-text-color-main);` +
      `border:1px solid var(--mybricks-border-color-main);flex-shrink:0;font-family:monospace">${name}</span>`
    ).join('')
    relatedLine =
      `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:0 0 8px;font-size:12px;color:var(--mybricks-text-color-sub)">` +
      `<span style="flex-shrink:0">关联UI：</span>${tags}</div>`
  }

  return titleLine + (relatedLine ? '\n' + relatedLine : '')
}

/**
 * 全文预处理（不在 fenced 代码块内的行）：
 * 1. flowchart/graph 裸行 → mermaid fenced 代码块
 * 2. ## 标题 或整行 **粗体标题**（如 **2. 搜索筛选栏**）后的 type/related/rank 裸行 → 融合进标题行的 HTML
 *    - 标题与首条 meta 之间允许若干空行或 --- / *** / ___ 分隔线；已写入 meta 后，空行仍表示 meta 块结束
 *    - type/related/rank 行可无列表横线，也可选 - * + • 等前缀；冒号支持半角 : 与中文 ：
 *    - type 标签在标题左侧，rank 标签在标题右侧，related 另起一行
 *    - 无序号标题的「1. 2. …」仅按带 type/related/rank 的功能点递增，背景类等 ## 标题不计入
 */
const preprocessBody = (text: string): string => {
  const lines = text.split('\n')
  const out: string[] = []
  let inFence = false
  let collectingMeta = false
  let metaBuf: { type?: string; related?: string; rank?: string } = {}
  let headingOutIdx = -1
  let headingText = ''
  /** 标题后、尚未出现任何 meta 行时的空行暂存（遇到 meta 则丢弃；遇到正文则 flush 在标题后输出） */
  let pendingAfterHeading: string[] = []
  /** 功能点序号：仅在有 type/related/rank 的标题 flush 时递增 */
  let featureOrdinal = 0

  const emitPendingAfterHeading = () => {
    if (pendingAfterHeading.length) {
      out.push(...pendingAfterHeading)
      pendingAfterHeading = []
    }
  }

  const hasFeatureMeta = (buf: typeof metaBuf) =>
    !!(buf.type?.trim() || buf.related?.trim() || buf.rank?.trim())

  const flushMeta = () => {
    if (headingOutIdx >= 0) {
      let ordinal: number | null = null
      if (hasFeatureMeta(metaBuf)) {
        featureOrdinal += 1
        ordinal = featureOrdinal
      }
      out[headingOutIdx] = renderHeadingWithMeta(
        headingText,
        ordinal,
        metaBuf.type,
        metaBuf.related,
        metaBuf.rank,
      )
    }
    collectingMeta = false
    metaBuf = {}
    headingOutIdx = -1
    headingText = ''
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // fenced 代码块切换
    if (/^```/.test(line)) {
      if (collectingMeta) {
        flushMeta()
        emitPendingAfterHeading()
      }
      inFence = !inFence
      out.push(line)
      continue
    }

    if (inFence) { out.push(line); continue }

    const trimmed = line.trim()

    // ## 标题 或整行 **粗体** 标题：如果正在收集 meta，先 flush，再开启新的收集
    let headingFromLine: string | null = null
    if (/^## /.test(line)) {
      headingFromLine = line.replace(/^## /, '').trim()
    } else {
      const boldOnly = trimmed.match(/^\*\*(.+)\*\*$/)
      if (boldOnly) headingFromLine = boldOnly[1].trim()
    }
    if (headingFromLine !== null) {
      if (collectingMeta) {
        flushMeta()
        emitPendingAfterHeading()
      }
      collectingMeta = true
      metaBuf = {}
      headingText = headingFromLine
      headingOutIdx = out.length
      out.push(line) // 先占位，flush 时替换
      continue
    }

    // 处于 meta 收集阶段
    if (collectingMeta) {
      if (trimmed === '') {
        if (Object.keys(metaBuf).length > 0) {
          // 已有 meta：空行结束 meta 块
          flushMeta()
          out.push(line)
          continue
        }
        // 标题后、尚无 meta：允许中间空行，直到出现 type/related/rank 或正文
        pendingAfterHeading.push(line)
        continue
      }
      // 标题与首条 meta 之间常见分隔线（--- / *** / ___），不参与正文
      if (
        Object.keys(metaBuf).length === 0 &&
        /^(?:-{3,}|_{3,}|\*{3,})\s*$/.test(trimmed)
      ) {
        continue
      }
      // 可选列表符 - * + • 全角横线等；键值支持半角/中文冒号（不要求行首必须有横线）
      const kvMatch = trimmed.match(
        /^(?:[-*+•\uFF0D\u2013\u2014]\s*)?(type|related|rank)\s*[:：]\s*(.+)$/i,
      )
      if (kvMatch) {
        pendingAfterHeading = []
        ;(metaBuf as any)[kvMatch[1].toLowerCase()] = kvMatch[2].trim()
        continue
      }
      // 非 meta 行：结束收集，flush，再正常处理该行
      flushMeta()
      emitPendingAfterHeading()
      // fall through to normal processing below
    }

    // flowchart/graph 裸行 → mermaid block
    if (/^(flowchart|graph)\s/.test(trimmed)) {
      out.push('```mermaid')
      out.push(trimmed)
      out.push('```')
      continue
    }

    out.push(line)
  }

  if (collectingMeta) {
    flushMeta()
    emitPendingAfterHeading()
  }

  return out.join('\n')
}

/**
 * 解析 requirement.md 为结构化数据。
 * 格式约定：
 * - 顶部 YAML front matter（---...---）含 title、desc 字段
 * - 正文为标准 markdown，预处理后存入 body：
 *   1. flowchart/graph 裸行 → mermaid 代码块
 *   2. 任意 ## 标题或整行 **粗体标题** 后的 type/related/rank 裸行（与标题间可有空行）→ HTML 标签行
 */
export const parseRequirement = (md: string): ParsedRequirement => {
  const result: ParsedRequirement = { body: '' }

  // 1. 提取并剥离 YAML front matter
  let body = md.trim()
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (fmMatch) {
    const fm = fmMatch[1]
    const titleMatch = fm.match(/^title\s*:\s*(.+)$/m)
    const descMatch = fm.match(/^desc\s*:\s*(.+)$/m)
    if (titleMatch) result.title = titleMatch[1].trim()
    if (descMatch) result.desc = descMatch[1].trim()
    body = body.slice(fmMatch[0].length).trim()
  }

  // 2. 预处理正文
  result.body = preprocessBody(body)

  return result
}
