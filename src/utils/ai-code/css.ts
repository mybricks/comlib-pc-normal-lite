export type LegacyCssMediaQuery = {
  conditionText: string
  cssText: string
  placeholder: string
}

/** 画布样式位于 Shadow DOM；顶层 @property 需加载到 document 才能完成注册。 */
export function syncCssPropertyRegistrations(componentId: string, fileId: string, css: string): void {
  const styleId = `mybricks-css-properties-${fileId}`
  const existing = document.getElementById(styleId)
  // 普通 CSS 无需解析；同文件删掉最后一个注册时同时移除文档里的声明。
  let registrations = ''
  if (css.includes('@property')) {
    // 临时样式表只负责解析，不挂载；文档中仅加载顶层注册声明。
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    registrations = Array.from(sheet.cssRules, rule => rule.cssText)
      .filter(rule => rule.startsWith('@property ')).join('\n')
  }
  if (!registrations) {
    existing?.remove()
    return
  }
  const style = existing || document.createElement('style')
  style.id = styleId
  style.setAttribute('data-mybricks-css-properties', componentId)
  if (style.textContent !== registrations) style.textContent = registrations
  if (!style.parentNode) document.head.appendChild(style)
}

export function removeCssPropertyRegistrations(componentId: string): void {
  document.querySelectorAll('style[data-mybricks-css-properties]').forEach(style => {
    if (style.getAttribute('data-mybricks-css-properties') === componentId) style.remove()
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
