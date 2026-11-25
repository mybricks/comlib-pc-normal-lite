import type { UiAnchor } from './parse'

/** Match the runtime source location by file and JSX line range. */
export function uiAnchorsToSelector(anchors: UiAnchor[]): string {
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return anchors.map(({ file, startLine, endLine }) => {
    const jsonFile = JSON.stringify(file).slice(1, -1)
    const codeLine = `"codeLine":{"start":${startLine},"end":${endLine}}`
    return `[data-loc*='${escape(jsonFile)}'][data-loc*='${escape(codeLine)}']`
  }).join(', ')
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
