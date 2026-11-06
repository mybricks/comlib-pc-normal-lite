const STYLE_PATTERN = /\.(?:bizai-root(?:[-_{.:\s]|$)|react-flow(?:__|[\s.{:#]))/
const GEOVIEW = '#_mybricks-geo-webview_'
const POLL_MS = 200
const GIVE_UP_MS = 5 * 60 * 1000

type StyleObserver = {
  observe(target: Node, options: { childList: boolean; subtree: boolean }): void
  disconnect(): void
}

type StyleObserverCtor = new (callback: (records: MutationRecord[]) => void) => StyleObserver

/** Prefer the document's own constructor so an iframe realm can observe its head. */
function styleObserverCtor(view: Window | null): StyleObserverCtor | undefined {
  if (view?.MutationObserver) return view.MutationObserver
  if (typeof MutationObserver !== 'undefined') return MutationObserver
  return undefined
}

function isStyleElement(node: Node): node is HTMLStyleElement {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'STYLE'
}

function collectStyles(node: Node, styles: HTMLStyleElement[]) {
  if (isStyleElement(node)) styles.push(node)
  Array.from(node.childNodes).forEach(child => collectStyles(child, styles))
}

/**
 * Copy the business-diagram stylesheets into the designer shadow root.
 * Lazy CSS may only sit in `head` for a moment, so a head observer records
 * those nodes immediately; polling covers a missing observer or a late geoview.
 */
export function attachShadowStyles(doc: Document): () => void {
  const copies = new Map<HTMLStyleElement, HTMLStyleElement>()
  const seen = new Set<HTMLStyleElement>()
  let stopped = false
  let poll = 0
  let observer: StyleObserver | undefined
  const view = doc.defaultView
  const deadline = Date.now() + GIVE_UP_MS
  const schedule = view?.setTimeout.bind(view) ?? setTimeout
  const cancel = view?.clearTimeout.bind(view) ?? clearTimeout

  const remember = (node: Node) => {
    const styles: HTMLStyleElement[] = []
    collectStyles(node, styles)
    styles.forEach(style => seen.add(style))
  }

  const sync = () => {
    const root = doc.querySelector(GEOVIEW)?.shadowRoot
    if (!root) return false
    Array.from(doc.querySelectorAll('style')).forEach(remember)
    seen.forEach(node => {
      if (copies.has(node) || !STYLE_PATTERN.test(node.textContent ?? '')) return
      const copy = node.cloneNode(true) as HTMLStyleElement
      copy.setAttribute('data-understand-shadow-style', '')
      root.appendChild(copy)
      copies.set(node, copy)
    })
    return copies.size > 0
  }

  const giveUp = () => {
    stopped = true
    if (poll) cancel(poll)
    observer?.disconnect()
  }

  const Ctor = styleObserverCtor(view)
  if (Ctor && doc.head) {
    try {
      observer = new Ctor(records => {
        if (stopped) return
        if (Date.now() >= deadline) { giveUp(); return }
        records?.forEach(record => record.addedNodes?.forEach(remember))
        sync()
      })
      observer.observe(doc.head, { childList: true, subtree: true })
    } catch {
      observer = undefined
    }
  }

  const watch = () => {
    if (stopped) return
    if (Date.now() >= deadline) { giveUp(); return }
    if (sync()) return
    poll = schedule(watch, POLL_MS)
  }
  watch()

  return () => {
    giveUp()
    copies.forEach(style => style.remove())
    copies.clear()
  }
}
