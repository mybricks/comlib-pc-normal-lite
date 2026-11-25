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

/** Associate field nodes with their UI descendants and UI nodes with their nearest field. */
export function buildNodeHints(diagram: ParsedDiagram): Map<string, ZoneHint> {
  const nodes = new Map(diagram.nodes.map(node => [node.id, node]))
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const edge of diagram.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source])
  }
  const selectors = (anchors: UiAnchor[]) => [...new Set(anchors.map(anchor => uiAnchorsToSelector([anchor])))]
  const toHint = (items: string[], title: string, multiple = false): ZoneHint => ({ selector: items.length === 1 && !multiple ? items[0] : items, title })
  const hints = new Map<string, ZoneHint>()
  for (const node of diagram.nodes) {
    if (node.field) {
      const pending = [...(outgoing.get(node.id) ?? [])], visited = new Set([node.id]), anchors: UiAnchor[] = []
      let uiCount = 0
      while (pending.length) {
        const id = pending.shift()!
        if (visited.has(id)) continue
        visited.add(id)
        const child = nodes.get(id)
        if (!child || child.field || child.source) continue
        if (child.ui?.length) { uiCount++; anchors.push(...child.ui) }
        pending.push(...(outgoing.get(id) ?? []))
      }
      hints.set(node.id, toHint(selectors(anchors), node.field.bind, uiCount > 1))
    } else if (node.ui?.length) {
      const pending = [...(incoming.get(node.id) ?? [])], visited = new Set([node.id])
      let title = ''
      while (pending.length) {
        const id = pending.shift()!
        if (visited.has(id)) continue
        visited.add(id)
        const parent = nodes.get(id)
        if (!parent) continue
        if (parent.field) { title = parent.field.bind; break }
        if (!parent.source) pending.push(...(incoming.get(id) ?? []))
      }
      hints.set(node.id, toHint(selectors(node.ui), title))
    }
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
