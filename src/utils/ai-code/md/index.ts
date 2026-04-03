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

/** 单个功能点 */
export type RequirementFeature = {
  title: string
  type?: string
  related?: string
  body: string
}

/** requirement.md 解析结果 */
export type ParsedRequirement = {
  title?: string
  desc?: string
  overview?: string
  features: RequirementFeature[]
}

/**
 * 解析 requirement.md 为结构化数据。
 * 格式约定：
 * - 顶部 YAML front matter（---...---）含 title、desc 字段
 * - # 概述：概述文本（可含 flowchart LR; ... 单行流程图）
 * - # 功能点列表：每个 ## 子标题为一个功能点
 *   - 紧跟 type: new/edit 和 related: xxx 纯文本行（非列表）
 */
export const parseRequirement = (md: string): ParsedRequirement => {
  const result: ParsedRequirement = { features: [] }

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

  // 2. 按 # 一级标题切分
  const h1Sections = body.split(/(?=^# )/m)

  for (const section of h1Sections) {
    const h1Match = section.match(/^# (.+)\n/)
    if (!h1Match) continue
    const h1Title = h1Match[1].trim()
    const h1Body = section.slice(h1Match[0].length)

    if (h1Title === '概述') {
      result.overview = h1Body.trim()
      continue
    }

    if (h1Title === '功能点列表') {
      // 按 ## 二级标题切分功能点
      const h2Sections = h1Body.split(/(?=^## )/m)
      for (const h2sec of h2Sections) {
        const h2Match = h2sec.match(/^## (.+)\n/)
        if (!h2Match) continue
        const featureTitle = h2Match[1].trim()
        const featureBody = h2sec.slice(h2Match[0].length)

        const typeMatch = featureBody.match(/^type\s*:\s*(.+)$/m)
        const relatedMatch = featureBody.match(/^related\s*:\s*(.+)$/m)

        result.features.push({
          title: featureTitle,
          type: typeMatch?.[1].trim(),
          related: relatedMatch?.[1].trim(),
          body: featureBody.trim(),
        })
      }
    }
  }

  return result
}
