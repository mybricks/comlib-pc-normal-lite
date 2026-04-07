import { fromMarkdown } from 'mdast-util-from-markdown'

// --- 目标结构类型（与 summary.md 约定一致）---
/** 单个关联组件 */
type SummaryRelation = { type: string; name: string }
/** 单个事件：id、标题、mermaid 流程图、可选关联组件 */
type SummaryEvent = { id: string; title: string; mermaid: string; relation?: SummaryRelation }
/** 单个区块：标题、摘要、类型，以及可选的 events 列表 */
type SummaryBlock = {
  title?: string
  summary?: string
  type?: string
  events?: SummaryEvent[]
}
/** 解析结果：区块名 -> 区块数据 */
type ParsedSummary = Record<string, SummaryBlock>

type AstNode = { type: string; value?: string; children?: AstNode[] }

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
 * 解析 relation 列表节点。
 * 每个 listItem 为独立的 key: value 行：
 *   - type: popup
 *   - name: ConfirmModal
 */
function parseRelation(listNode: AstNode): SummaryRelation {
  const kv: Record<string, string> = {}
  for (const item of listNode.children ?? []) {
    if (item.type !== 'listItem') continue
    const text = getListItemText(item)
    const colonIdx = text.indexOf(':')
    if (colonIdx === -1) continue
    const key = text.slice(0, colonIdx).trim()
    const value = text.slice(colonIdx + 1).trim()
    if (key) kv[key] = value
  }
  return { type: kv['type'] ?? '', name: kv['name'] ?? '' }
}

/**
 * 解析 events 的 listItem。
 * AST 结构：
 *   listItem (paragraph → "events:")
 *     list
 *       listItem           ← 每个事件
 *         paragraph → "openModal"   （无冒号）
 *         list
 *           listItem → "title: 打开弹窗"
 *           listItem → "mermaid: flowchart LR; ..."
 *           listItem (paragraph → "relation:")
 *             list
 *               listItem → "type: popup"
 *               listItem → "name: ConfirmModal"
 */
function parseEventsItem(item: AstNode): SummaryEvent[] {
  const events: SummaryEvent[] = []
  const eventsNestedList = getNestedList(item)
  if (!eventsNestedList) return events

  for (const evItem of eventsNestedList.children ?? []) {
    if (evItem.type !== 'listItem') continue
    // id: 纯文本，无冒号（旧格式兼容：末尾有冒号则去掉）
    const idText = getListItemText(evItem).trim()
    const id = idText.endsWith(':') ? idText.slice(0, -1).trim() : idText
    if (!id) continue

    const propsListNode = getNestedList(evItem)
    if (!propsListNode) {
      events.push({ id, title: '', mermaid: '' })
      continue
    }

    let title = ''
    let mermaid = ''
    let relation: SummaryRelation | undefined

    for (const propItem of propsListNode.children ?? []) {
      if (propItem.type !== 'listItem') continue
      const text = getListItemText(propItem)

      if (text === 'relation:') {
        const relList = getNestedList(propItem)
        if (relList) relation = parseRelation(relList)
        continue
      }

      const colonIdx = text.indexOf(':')
      if (colonIdx === -1) continue
      const key = text.slice(0, colonIdx).trim()
      const value = text.slice(colonIdx + 1).trim()
      if (key === 'title') title = value
      else if (key === 'mermaid') mermaid = value
    }

    const ev: SummaryEvent = { id, title, mermaid }
    if (relation) ev.relation = relation
    events.push(ev)
  }

  return events
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
  const children = (ast as unknown as AstNode).children ?? []
  let currentKey = ''

  for (const node of children) {
    if (node.type === 'heading') {
      currentKey = getNodeText(node)
      if (currentKey && !result[currentKey]) result[currentKey] = {}
      continue
    }

    if (node.type === 'thematicBreak') continue

    if (node.type === 'list' && currentKey) {
      for (const item of node.children ?? []) {
        if (item.type !== 'listItem') continue
        const lineText = getListItemText(item)

        if (lineText === 'events:') {
          result[currentKey].events = parseEventsItem(item)
          continue
        }

        const colonIdx = lineText.indexOf(':')
        if (colonIdx !== -1) {
          const key = lineText.slice(0, colonIdx).trim()
          const value = lineText.slice(colonIdx + 1).trim()
          if (key && (result[currentKey] as Record<string, unknown>)[key] === undefined) {
            (result[currentKey] as Record<string, unknown>)[key] = value
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
   * 2. ## 标题后紧跟的 type/related/rank 裸行 → HTML 标签行（可出现在文档任意位置）
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
 * - 若标题无序号，自动在左侧添加序号（调用方传入）
 * - 标题行：序号 + 标题文字，右侧依次 [rank标签] [type标签]
 * - related 另起一行，前缀「关联UI：」
 */
const renderHeadingWithMeta = (
  headingText: string,
  index: number,
  type?: string,
  related?: string,
  rank?: string,
): string => {
  // 若标题不以数字/中文序号开头，自动加序号
  const hasIndex = /^[\d一二三四五六七八九十]/.test(headingText)
  const displayTitle = hasIndex ? headingText : `${index}. ${headingText}`

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
 * 2. ## 标题后紧跟的 type/related/rank 裸行 → 融合进标题行的 HTML
 *    - type 标签在标题左侧，rank 标签在标题右侧，related 另起一行
 */
const preprocessBody = (text: string): string => {
  const lines = text.split('\n')
  const out: string[] = []
  let inFence = false
  let collectingMeta = false
  let metaBuf: { type?: string; related?: string; rank?: string } = {}
  let headingOutIdx = -1
  let headingText = ''
  // ## 标题计数，用于无序号标题自动添加序号
  let featureIndex = 0

  const flushMeta = () => {
    if (headingOutIdx >= 0) {
      out[headingOutIdx] = renderHeadingWithMeta(headingText, featureIndex, metaBuf.type, metaBuf.related, metaBuf.rank)
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
      if (collectingMeta) flushMeta()
      inFence = !inFence
      out.push(line)
      continue
    }

    if (inFence) { out.push(line); continue }

    const trimmed = line.trim()

    // ## 标题：如果正在收集 meta，先 flush，再开启新的收集
    if (/^## /.test(line)) {
      if (collectingMeta) flushMeta()
      featureIndex++
      collectingMeta = true
      metaBuf = {}
      headingText = line.replace(/^## /, '').trim()
      headingOutIdx = out.length
      console.log('[preprocessBody] heading detected:', JSON.stringify(headingText), 'idx:', headingOutIdx)
      out.push(line) // 先占位，flush 时替换
      continue
    }

    // 处于 meta 收集阶段
    if (collectingMeta) {
      if (trimmed === '') {
        // 空行：结束收集，flush，然后输出空行
        console.log('[preprocessBody] flush on empty line, metaBuf:', metaBuf)
        flushMeta()
        out.push(line)
        continue
      }
      const kvMatch = trimmed.match(/^-?\s*(type|related|rank)\s*:\s*(.+)$/i)
      if (kvMatch) {
        console.log('[preprocessBody] meta matched:', kvMatch[1], '=', kvMatch[2])
        ;(metaBuf as any)[kvMatch[1].toLowerCase()] = kvMatch[2].trim()
        continue
      }
      // 非 meta 行：结束收集，flush，再正常处理该行
      console.log('[preprocessBody] flush on non-meta line:', JSON.stringify(trimmed), 'metaBuf:', metaBuf)
      flushMeta()
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

  if (collectingMeta) flushMeta()

  return out.join('\n')
}

/**
 * 解析 requirement.md 为结构化数据。
 * 格式约定：
 * - 顶部 YAML front matter（---...---）含 title、desc 字段
 * - 正文为标准 markdown，预处理后存入 body：
 *   1. flowchart/graph 裸行 → mermaid 代码块
 *   2. 任意 ## 标题后紧跟的 type/related/rank 裸行 → HTML 标签行
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
