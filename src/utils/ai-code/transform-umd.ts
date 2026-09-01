import babelPlugin from './plugins/babelPlugin'
import { getValidatorPlugins } from '../../mix/availableLibraries'
import functionPropsPlugin from './plugins/functionPropsPlugin'
import collectJsDocPlugin from './plugins/collectJsDocPlugin'
import loggerPlugin from './plugins/loggerPlugin'
import styleAnalysisPlugin from './plugins/styleAnalysisPlugin'
import zoneIndexPlugin from './plugins/zoneIndexPlugin'
import esmPreCheckPlugin from './plugins/esmPreCheckPlugin'
import wrapThirdPartyPlugin from './plugins/wrapThirdPartyPlugin'
import skillBoundaryPlugin from './render/mybricks/gui-card-next/skill-boundary-plugin'
import eslintCheckPlugin from './plugins/eslintCheckPlugin'
import appConfigCheckPlugin from './plugins/appConfigCheckPlugin'
import config from '../../mix/context/config'
import { generate as generateCss, parse as parseCss, walk as walkCss } from 'css-tree'

export function transformTsx(code, ctx: import('../../mix/availableLibraries/types').ValidateContext): { transformCode: string, jsDocMap: any } {
  let transformCode
  const errors: Error[] = []
  const onError = (error: Error) => {
    if (error) {
      errors.push(error)
    }
  }
  const { fileName } = ctx
  const jsDocMap = new Map()
  const frontendMode = config.getFrontendMode()
  const isReactNativeRender = config.isReactNativeRender()

  try {
    const validatorPlugins = getValidatorPlugins({ ...ctx, fileName, onError })

    const babelPlugins = window._sandbox_.config.componentRuntime?.babelPlugins?.map((babelPlugin) => {
      return babelPlugin({ filename: fileName, onError })
    }) || []

    const options = {
      filename: fileName,
      presets: [
        [
          "env",
          {
            "modules": "commonjs"//umd->commonjs
          }
        ],
        'react'
      ],
      plugins: [
        eslintCheckPlugin(code, config.getESLint(), onError),
        esmPreCheckPlugin(onError),
        ['proposal-decorators', {legacy: true}],
        'proposal-class-properties',
        [
          'transform-typescript',
          {
            isTSX: true
          }
        ],
        ...babelPlugins,
        ...(frontendMode === 'prototype' ? [appConfigCheckPlugin(fileName, onError),] : []),
        // 纯 RN 页面模式也未注入 react-native/plugins。该插件会改写 RN 节点和 StyleSheet 产物，
        // 在 gui_card 的卡片渲染器中会把有效组件变为对象；这里仅跳过 Web 专属转换。
        // 后续若接入 RN 可视化选中能力，需先验证 RN Skill 卡片在设计态与运行态都可正常渲染。
        ...(isReactNativeRender || frontendMode === 'react-native' ? [] : [babelPlugin({ fileName: ctx?.fileName }), wrapThirdPartyPlugin(), styleAnalysisPlugin()]),
        ...validatorPlugins,
        functionPropsPlugin(),
        [collectJsDocPlugin, { result: jsDocMap, fileName }],
        loggerPlugin({ fileName }),
        zoneIndexPlugin({ fileName }),
        ...(frontendMode === 'gui_card' ? [skillBoundaryPlugin({ fileName, onError })] : [])
      ],
      retainLines: true,
    }

    if (!window.Babel) {
      loadBabel()
      throw new Error('当前环境 BaBel编译器 未准备好')
    } else {
      transformCode = window.Babel.transform(code, options).code
      if (errors.length > 0) {
        const detail = errors.map((e) => e.message).join('\n\n')
        throw new SyntaxError(`当前文件共发现 ${errors.length} 个错误：\n\n${detail}`)
      }
    }

  } catch (error) {
    console.error("[@transformTsx error]", error);
    throw error
  }

  return { transformCode, jsDocMap }
}

export function transformLess(code, filename: string) {
  const prefix = filename.replace(/\./g, '__').replace(/\//g, '_')
  const useCssModule = filename.endsWith('.module.less')
  const cssModule: any = {
    cssContent: "",
    classMap: {},
    imports: [],
    mediaQueries: []
  }

  if (!code || code.length === 0) {
    return cssModule
  }

  const externalLessPlugins = window._sandbox_?.config?.componentRuntime?.lessPlugins?.map((factory) => {
    return factory({ filename })
  }) || []

  window.less.render(code, {
    javascriptEnabled: true,
    plugins: [
      {
        install: function (less, pluginManager) {
          pluginManager.addPreProcessor({
            process: function (src, _extra) {
              const importRegex = /@import\s+(?:\([^)]*\)\s*)?['"]([^'"]+)['"]\s*;?/g
              let im: RegExpExecArray | null
              while ((im = importRegex.exec(src)) !== null) {
                cssModule.imports.push(im[1])
              }
              // 移除所有 @import 语句，避免浏览器环境下尝试通过 HTTP 加载文件
              src = src.replace(/@import\s+(?:(?:['"][^'"]*['"])|(?:\([^)]*\)\s*['"][^'"]*['"]))\s*;?/g, '')

              // Step 1: 保护所有不应被类名替换影响的内容（字符串、注释、url()），
              // 必须在 globalRanges 计算之前完成，确保偏移量基于同一字符串
              const placeholders: string[] = []
              const protect = (match: string) => {
                const idx = placeholders.length
                placeholders.push(match)
                return `__LESS_PLACEHOLDER_${idx}__`
              }
              // 保护顺序：块注释 → url()（含引号/无引号）→ 字符串（双引号/单引号）→ 行注释
              // 注意：行注释必须最后处理，否则会误匹配字符串内的 // (如 url("http://..."))
              let safeSrc = src
                // 块注释 /* ... */
                .replace(/\/\*[\s\S]*?\*\//g, protect)
                // url() 含引号形式（优先整体保护，避免内部引号或 // 被提前替换）
                .replace(/url\s*\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)]*)\s*\)/gi, protect)
                // 双引号字符串
                .replace(/"(?:[^"\\]|\\.)*"/g, protect)
                // 单引号字符串
                .replace(/'(?:[^'\\]|\\.)*'/g, protect)
                // 行注释 //...（必须在字符串和 url() 保护之后）
                .replace(/\/\/[^\n]*/g, protect)

              // Step 2: 在保护后的字符串上计算 :global 范围（偏移量一致）
              const globalRanges: Array<[number, number]> = []

              // :global(.a .b) 形式
              const parenRegex = /:global\s*\(/g
              let pm: RegExpExecArray | null
              while ((pm = parenRegex.exec(safeSrc)) !== null) {
                let depth = 1
                let i = pm.index + pm[0].length
                while (i < safeSrc.length && depth > 0) {
                  if (safeSrc[i] === '(') depth++
                  else if (safeSrc[i] === ')') depth--
                  i++
                }
                globalRanges.push([pm.index, i])
              }

              // :global { ... } 形式
              const braceRegex = /:global\s*\{/g
              let bm: RegExpExecArray | null
              while ((bm = braceRegex.exec(safeSrc)) !== null) {
                let depth = 1
                let i = bm.index + bm[0].length
                while (i < safeSrc.length && depth > 0) {
                  if (safeSrc[i] === '{') depth++
                  else if (safeSrc[i] === '}') depth--
                  i++
                }
                globalRanges.push([bm.index, i])
              }

              const isInGlobal = (index: number) =>
                globalRanges.some(([start, end]) => index >= start && index < end)

              // Step 3: 类名替换（在 safeSrc 上操作，偏移量与 globalRanges 一致）
              let processed = safeSrc.replace(
                /\.([a-zA-Z][a-zA-Z0-9_-]*)/g,
                (match, className, offset) => {
                  if (!useCssModule) {
                    // *.less 文件：不做 CSS Module 转换，直接返回原始类名
                    return match
                  }
                  if (isInGlobal(offset)) {
                    cssModule.classMap[className] = className
                    return match
                  }
                  const hashedName = `${prefix ? `${prefix}--` : ""}${className}`;
                  cssModule.classMap[className] = hashedName;
                  return `.${hashedName}`;
                },
              )

              // Step 4: 还原所有占位符
              processed = processed.replace(/__LESS_PLACEHOLDER_(\d+)__/g, (_, idx) => placeholders[Number(idx)])

              // Remove :global(...) wrapper, keep inner content
              processed = processed.replace(/:global\s*\(([^)]*)\)/g, '$1')

              // Remove :global { ... } wrapper, keep inner block content
              processed = processed.replace(/:global\s*\{([\s\S]*?)\}/g, (match, inner) => {
                // Unwrap: remove the outer braces but keep the inner rules
                return inner
              })

              return processed
            },
          })
        },
      },
      ...externalLessPlugins,
    ],
  }, (error, result) => {
    if (error) {
      // console.error(error)
      throw new Error(`Less 代码编译失败: ${error.message}`)
    } else {
      const { cssContent, mediaQueries } = extractMediaQueries(convertRemToPx(result?.css || ''))
      cssModule.cssContent = cssContent
      cssModule.mediaQueries = mediaQueries
    }
  })

  return cssModule;
}

const REM_BASE_PX = 16

function convertRemToPx(css: string): string {
  const cssAst = parseCss(css, { context: 'stylesheet' })

  transformRemDimensions(cssAst)

  // css-tree intentionally preserves unsupported and custom-property values as
  // Raw nodes. Parse those values separately so their dimensions are not missed.
  walkCss(cssAst, {
    visit: 'Raw',
    enter: (node: any) => {
      try {
        const valueAst = parseCss(node.value, { context: 'value' })
        transformRemDimensions(valueAst)
        node.value = generateCss(valueAst)
      } catch {
        // Keep syntaxes that css-tree does not understand unchanged.
      }
    },
  })

  return generateCss(cssAst)
}

function transformRemDimensions(ast: any) {
  walkCss(ast, {
    visit: 'Dimension',
    enter: (node: any) => {
      if (node.unit.toLowerCase() === 'rem') {
        node.value = String(Number(node.value) * REM_BASE_PX)
        node.unit = 'px'
      }
    },
  })
}

function extractMediaQueries(css: string): {
  cssContent: string
  mediaQueries: Array<{ conditionText: string; cssText: string; placeholder: string }>
} {
  if (!css) {
    return { cssContent: '', mediaQueries: [] }
  }

  // CSSOM cssText can corrupt shorthands containing var(), so use css-tree offsets.
  return extractMediaQueriesByAst(css)
}

function extractMediaQueriesByAst(css: string): {
  cssContent: string
  mediaQueries: Array<{ conditionText: string; cssText: string; placeholder: string }>
} {
  const mediaQueries: Array<{ conditionText: string; cssText: string; placeholder: string }> = []
  const ranges: Array<[number, number, string]> = []

  try {
    const cssAst = parseCss(css, { context: 'stylesheet', positions: true })
    cssAst.children.forEach((node: any) => {
      if (node.type !== 'Atrule' || !isMediaAtRule(node.name) || !node.block?.loc) {
        return
      }

      const start = node.loc.start.offset
      const blockStart = node.block.loc.start.offset
      const end = node.loc.end.offset
      const lastChildEnd = node.block.children.last?.loc?.end.offset
      const conditionStart = node.prelude?.loc?.start.offset ?? blockStart

      // css-tree can recover an omitted closing brace. Keep malformed source intact.
      if (css[blockStart] !== '{' || css[end - 1] !== '}' || lastChildEnd === end) {
        return
      }

      const placeholder = `/* __MYBRICKS_AI_MEDIA_QUERY_${mediaQueries.length}__ */`
      mediaQueries.push({
        conditionText: css.slice(conditionStart, blockStart).trim(),
        cssText: css.slice(blockStart + 1, end - 1).trim(),
        placeholder
      })
      ranges.push([start, end, placeholder])
    })
  } catch {
    // Keep CSS that cannot be parsed unchanged instead of risking a partial split.
    return { cssContent: css, mediaQueries }
  }

  let cssContent = ''
  let lastIndex = 0
  ranges.forEach(([start, end, placeholder]) => {
    cssContent += css.slice(lastIndex, start)
    cssContent += placeholder
    lastIndex = end
  })
  cssContent += css.slice(lastIndex)

  return {
    cssContent: cssContent.trim(),
    mediaQueries
  }
}

function isMediaAtRule(name: unknown): boolean {
  return typeof name === 'string' && decodeCssIdentifier(name).toLowerCase() === 'media'
}

function decodeCssIdentifier(value: string): string {
  return value.replace(/\\(?:([0-9a-fA-F]{1,6})[\t\n\f\r ]?|([\s\S]))/g, (_, hex, character) => {
    if (!hex) {
      return character
    }

    const codePoint = Number.parseInt(hex, 16)
    return codePoint === 0 || codePoint > 0x10FFFF ? '\uFFFD' : String.fromCodePoint(codePoint)
  })
}

async function requireFromCdn(cdnUrl) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = cdnUrl
    document.body.appendChild(el)
    el.onload = () => {
      resolve(true)
    }
    el.onerror = () => {
      reject(new Error(`加载${cdnUrl}失败`))
    }
  })
}

async function loadBabel() {
  if (window?.Babel) {
    return
  }

  await requireFromCdn('https://f2.beckwai.com/udata/pkg/eshop/fangzhou/asset/babel/standalone/7.24.7/babel.min.js')
}

export function uuid(pre = 'u_', len = 6) {
  const seed = 'abcdefhijkmnprstwxyz0123456789', maxPos = seed.length;
  let rtn = '';
  for (let i = 0; i < len; i++) {
    rtn += seed.charAt(Math.floor(Math.random() * maxPos));
  }
  return pre + rtn;
}
