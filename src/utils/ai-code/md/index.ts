import { fromMarkdown } from 'mdast-util-from-markdown'

// --- 目标结构类型（与 summary.md 约定一致）---
/** 单个事件：id、标题、mermaid 流程图 */
type SummaryEvent = { id: string; title: string; mermaid: string }
/** 单个区块：标题、摘要、类型，以及可选的 events 列表 */
type SummaryBlock = {
  title?: string
  summary?: string
  type?: string
  events?: SummaryEvent[]
}
/** 解析结果：区块名 -> 区块数据 */
type ParsedSummary = Record<string, SummaryBlock>

/**
 * 从 mdast 节点及其子节点中递归提取纯文本（用于 paragraph / heading 等）
 */
function getNodeText(node: { type: string; value?: string; children?: unknown[] }): string {
  if (node.type === 'text' && typeof node.value === 'string') return node.value
  if (Array.isArray(node.children)) return node.children.map((c: unknown) => getNodeText(c as { type: string; value?: string; children?: unknown[] })).join('')
  return ''
}

/**
 * 解析事件行：格式为 "id 标题 - flowchart LR; ..." 或 "id 标题 - mermaid..."
 * 以第一个 " - " 分割：左侧为 "id 标题"（第一个空格前为 id，其余为 title），右侧为 mermaid 字符串
 */
function parseEventLine(line: string): SummaryEvent | null {
  const sep = ' - '
  const idx = line.indexOf(sep)
  if (idx === -1) return null
  const left = line.slice(0, idx).trim()
  const mermaid = line.slice(idx + sep.length).trim()
  const spaceIdx = left.indexOf(' ')
  const id = spaceIdx === -1 ? left : left.slice(0, spaceIdx)
  const title = spaceIdx === -1 ? '' : left.slice(spaceIdx + 1).trim()
  return { id, title, mermaid }
}

/**
 * 将 summary.md 解析为结构化数据。
 * 约定：根节点 children 顺序为 [heading, list?, thematicBreak?]*；
 * - heading：当前区块 key（# 或 ## 或 ### 的文本）
 * - list：紧接在该 heading 后的属性列表，listItem 为 "key: value" 或 "events:"+ 嵌套列表
 * - thematicBreak（---）：仅作分隔，下一项为新 heading
 */
const parsemd = (md: string): ParsedSummary => {
  const ast = fromMarkdown(md)
  const result: ParsedSummary = {}
  const children = (ast as { type: string; children?: unknown[] }).children ?? []
  let currentKey: string = ''

  for (let i = 0; i < children.length; i++) {
    const node = children[i] as { type: string; depth?: number; children?: unknown[] }

    if (node.type === 'heading') {
      // 当前区块名：取 heading 内所有文本
      currentKey = getNodeText(node as unknown as { type: string; value?: string; children?: unknown[] })
      if (currentKey && !result[currentKey]) result[currentKey] = {}
      continue
    }

    if (node.type === 'thematicBreak') {
      continue
    }

    if (node.type === 'list' && currentKey) {
      const listItems = node.children ?? []
      for (const item of listItems as { type: string; children?: unknown[] }[]) {
        if (item.type !== 'listItem') continue
        const itemChildren = item.children ?? []
        // 第一个子节点多为 paragraph，取整行文本
        const first = itemChildren[0] as { type: string; children?: unknown[] } | undefined
        const lineText = first ? getNodeText(first as unknown as { type: string; value?: string; children?: unknown[] }) : ''

        if (lineText === 'events:') {
          // 本 listItem 内含嵌套 list，子项格式为 "id title - mermaid"
          const nestedList = itemChildren.find((c: unknown) => (c as { type: string }).type === 'list') as { children?: unknown[] } | undefined
          const events: SummaryEvent[] = []
          if (nestedList?.children) {
            for (const sub of nestedList.children as { type: string; children?: unknown[] }[]) {
              if (sub.type !== 'listItem') continue
              const subFirst = sub.children?.[0]
              const subText = subFirst ? getNodeText(subFirst as unknown as { type: string; value?: string; children?: unknown[] }) : ''
              const ev = parseEventLine(subText)
              if (ev) events.push(ev)
            }
          }
          result[currentKey].events = events
          continue
        }

        // 普通 "key: value" 行
        const colonIdx = lineText.indexOf(':')
        if (colonIdx !== -1) {
          const key = lineText.slice(0, colonIdx).trim()
          const value = lineText.slice(colonIdx + 1).trim()
          if (key && (result[currentKey] as Record<string, unknown>)[key] === undefined) (result[currentKey] as Record<string, unknown>)[key] = value
        }
      }
    }
  }

  return result
}

export { parsemd }
