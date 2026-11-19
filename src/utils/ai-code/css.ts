import { generate, parse, walk } from 'css-tree'

/** 将独立编译的导入样式放进当前模块的作用域，导入规则先于本地规则。 */
export function composeLessImports(
  filename: string,
  local: { cssContent: string, classMap: Record<string, string> },
  imports: Array<{ cssContent?: string, classMap?: Record<string, string> }>,
) {
  const prefix = filename.replace(/\./g, '__').replace(/\//g, '_')
  const scoped = filename.endsWith('.module.less')
  const classMap: Record<string, string> = { ...local.classMap }
  const contents = imports.map(imported => {
    const replacements = new Map<string, string>()
    Object.entries(imported.classMap || {}).forEach(([name, original]) => {
      // identity 映射表示 :global，不能重新划入局部作用域。
      const target = original === name ? name : scoped ? `${prefix}--${name}` : name
      if (!Object.prototype.hasOwnProperty.call(classMap, name)) classMap[name] = target
      replacements.set(original, original === name ? name : classMap[name])
    })
    const ast = parse(imported.cssContent || '', { context: 'stylesheet' })
    walk(ast, {
      visit: 'ClassSelector',
      enter(node: any) {
        node.name = replacements.get(node.name) || node.name
      },
    })
    return generate(ast)
  })
  return { classMap, cssContent: [...contents, local.cssContent].join('\n') }
}

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
