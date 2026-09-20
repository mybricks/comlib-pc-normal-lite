export type LegacyCssMediaQuery = {
  conditionText: string
  cssText: string
  placeholder: string
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
