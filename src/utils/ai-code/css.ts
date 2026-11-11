export type LegacyCssMediaQuery = {
  conditionText: string
  cssText: string
  placeholder: string
}

/** Shadow DOM 内的 @property 不参与注册；只把本功能生成的注册规则同步到文档。 */
export function syncMotionFillRegistrations(componentId: string, fileId: string, css: string): void {
  const styleId = `mybricks-motion-properties-${fileId}`
  const existing = document.getElementById(styleId)
  const registrations = css.match(/@property\s+--mybricks-motion-fill-[\w-]+\s*\{[^{}]*\}/g)
  if (!registrations) {
    existing?.remove()
    return
  }
  const style = existing || document.createElement('style')
  style.id = styleId
  style.setAttribute('data-mybricks-motion-component', componentId)
  const content = registrations.join('\n')
  if (style.textContent !== content) style.textContent = content
  if (!style.parentNode) document.head.appendChild(style)
}

export function removeMotionFillRegistrations(componentId: string): void {
  document.querySelectorAll('style[data-mybricks-motion-component]').forEach(style => {
    if (style.getAttribute('data-mybricks-motion-component') === componentId) style.remove()
  })
}

export function normalizeContainerCondition(conditionText: string): string {
  return conditionText
    .replace(/^\s*(?:(?:not\s+)?(?:only\s+)?(?:all|screen|print)\s+and\s+)/i, '')
    .trim()
}

/**
 * 兼容旧版编译产物：旧产物把媒体查询替换成占位符，加载时恢复为容器查询。
 */
export function getCompiledCssContent(cssModule: {
  cssContent?: string
  mediaQueries?: LegacyCssMediaQuery[]
}): string {
  const cssContent = cssModule?.cssContent || ''
  const mediaQueries = cssModule?.mediaQueries

  if (!Array.isArray(mediaQueries) || mediaQueries.length === 0) {
    return cssContent
  }

  return mediaQueries.reduce((css, query) => {
    if (!query?.placeholder) {
      return css
    }

    const condition = normalizeContainerCondition(query.conditionText) || query.conditionText.trim()

    return css.replaceAll(
      query.placeholder,
      `@container ${condition} {${query.cssText || ''}}`,
    )
  }, cssContent)
}
