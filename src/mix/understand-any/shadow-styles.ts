/** Copy the business diagram stylesheet into the designer's shadow root. */
export function attachShadowStyles(doc: Document): () => void {
  const root = doc.querySelector('#_mybricks-geo-webview_')?.shadowRoot
  if (!root) return () => {}

  const copies = Array.from(doc.querySelectorAll('style'))
    .filter(style => /\.(?:bizai-root(?:[-_{.:\s]|$)|react-flow(?:__|[\s.{:#]))/.test(style.textContent ?? ''))
    .map(style => {
      const copy = style.cloneNode(true) as HTMLStyleElement
      copy.setAttribute('data-understand-shadow-style', '')
      root.appendChild(copy)
      return copy
    })

  return () => copies.forEach(style => style.remove())
}
