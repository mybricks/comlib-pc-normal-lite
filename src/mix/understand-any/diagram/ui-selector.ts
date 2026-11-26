import type { ParsedDiagram, UiAnchor } from './parse'

/** Match the runtime source location by file and JSX line range. */
export function uiAnchorsToSelector(anchors: UiAnchor[]): string {
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return anchors.map(({ file, startLine, endLine }) => {
    const jsonFile = JSON.stringify(file).slice(1, -1)
    const codeLine = `"codeLine":{"start":${startLine},"end":${endLine}}`
    return `[data-loc*='${escape(jsonFile)}'][data-loc*='${escape(codeLine)}']`
  }).join(', ')
}


export type ZoneHint = { selector: string | string[]; title: string }

/** Collect UI locations from each data node and all of its downstream fields. */
export function buildNodeHints(diagram: ParsedDiagram): Map<string, ZoneHint> {
  const nodes = new Map(diagram.nodes.map(node => [node.id, node]))
  const outgoing = new Map<string, string[]>()
  for (const edge of diagram.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  const hints = new Map<string, ZoneHint>()
  for (const node of diagram.nodes) {
    const title = node.field?.bind ?? node.source?.bind
    if (!title) continue
    const pending = [node.id], visited = new Set<string>(), selectors = new Set<string>()
    while (pending.length) {
      const id = pending.pop()!
      if (visited.has(id)) continue
      visited.add(id)
      const current = nodes.get(id)
      if (!current) continue
      if (current.field) for (const anchor of current.ui ?? []) selectors.add(uiAnchorsToSelector([anchor]))
      pending.push(...(outgoing.get(id) ?? []))
    }
    const items = [...selectors]
    if (items.length) hints.set(node.id, { selector: items.length === 1 ? items[0] : items, title })
  }
  return hints
}

/** Find matches in open shadow roots and accessible iframe documents for diagnostics. */
export function findUiMatches(root: Document | ShadowRoot, selector: string): Element[] {
  const pending: Array<Document | ShadowRoot> = [root]
  const visited = new Set<Document | ShadowRoot>()
  const matches = new Set<Element>()
  while (pending.length) {
    const scope = pending.pop()!
    if (visited.has(scope)) continue
    visited.add(scope)
    scope.querySelectorAll(selector).forEach(element => matches.add(element))
    scope.querySelectorAll('*').forEach(element => {
      if (element.shadowRoot) pending.push(element.shadowRoot)
      if (element.tagName === 'IFRAME') {
        try {
          const frameDocument = (element as HTMLIFrameElement).contentDocument
          if (frameDocument) pending.push(frameDocument)
        } catch { /* Cross-origin frame cannot be inspected. */ }
      }
    })
  }
  return [...matches]
}

/** Collect documents that can receive pointer events without crossing origins. */
export function getUiDocuments(root: Document): Document[] {
  const pending: Array<Document | ShadowRoot> = [root], visited = new Set<Document | ShadowRoot>()
  const documents = new Set<Document>([root])
  while (pending.length) {
    const scope = pending.pop()!
    if (visited.has(scope)) continue
    visited.add(scope)
    scope.querySelectorAll('*').forEach(element => {
      if (element.shadowRoot) pending.push(element.shadowRoot)
      if (element.tagName === 'IFRAME') {
        try {
          const frameDocument = (element as HTMLIFrameElement).contentDocument
          if (frameDocument) { documents.add(frameDocument); pending.push(frameDocument) }
        } catch { /* Cross-origin frames cannot be inspected. */ }
      }
    })
  }
  return [...documents]
}
