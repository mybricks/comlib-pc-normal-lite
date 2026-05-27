import React from 'react'
import babelPlugin from './plugins/babelPlugin'
import { getValidatorPlugins } from '../../mix/availableLibraries'
import functionPropsPlugin from './plugins/functionPropsPlugin'
import collectJsDocPlugin from './plugins/collectJsDocPlugin'
import loggerPlugin from './plugins/loggerPlugin'

export function transformTsx(code, ctx: import('../../mix/availableLibraries/types').ValidateContext): { transformCode: string, constituency: any, jsDocMap: any } {
  let transformCode
  const constituency: any = [];
  const { fileName } = ctx
  const jsDocMap = new Map()

  try {
    const validatorPlugins = getValidatorPlugins({ fileName })

    const babelPlugins = window._sandbox_.config.componentRuntime?.babelPlugins?.map((babelPlugin) => {
      return babelPlugin({ filename: fileName })
    }) || []

    const options = {
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
        ['proposal-decorators', {legacy: true}],
        'proposal-class-properties',
        [
          'transform-typescript',
          {
            isTSX: true
          }
        ],
        ...babelPlugins,
        babelPlugin({ constituency, fileName: ctx?.fileName }),
        ...validatorPlugins,
        functionPropsPlugin(),
        [collectJsDocPlugin, { result: jsDocMap, fileName }],
        loggerPlugin({ fileName })
      ],
      retainLines: true,
    }

    if (!window.Babel) {
      loadBabel()
      throw new Error('当前环境 BaBel编译器 未准备好')
    } else {
      transformCode = window.Babel.transform(code, options).code
    }

  } catch (error) {
    console.error("[@transformTsx error]", error);
    throw error
  }

  return { transformCode, constituency, jsDocMap }
}

export function transformLess(code, filename: string) {
  const prefix = filename.replace(/[^0-9a-zA-Z_]/g, '_')
  const useCssModule = filename.endsWith('.module.less')
  const cssModule: any = {
    cssContent: "",
    classMap: {},
    imports: []
  }

  if (!code || code.length === 0) {
    return cssModule
  }

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

              // 在预处理阶段收集类名
              // 先收集所有 :global(...) 和 :global { ... } 的范围，跳过其中的类名
              const globalRanges: Array<[number, number]> = []

              // :global(.a .b) 形式
              const parenRegex = /:global\s*\(/g
              let pm: RegExpExecArray | null
              while ((pm = parenRegex.exec(src)) !== null) {
                let depth = 1
                let i = pm.index + pm[0].length
                while (i < src.length && depth > 0) {
                  if (src[i] === '(') depth++
                  else if (src[i] === ')') depth--
                  i++
                }
                globalRanges.push([pm.index, i])
              }

              // :global { ... } 形式
              const braceRegex = /:global\s*\{/g
              let bm: RegExpExecArray | null
              while ((bm = braceRegex.exec(src)) !== null) {
                let depth = 1
                let i = bm.index + bm[0].length
                while (i < src.length && depth > 0) {
                  if (src[i] === '{') depth++
                  else if (src[i] === '}') depth--
                  i++
                }
                globalRanges.push([bm.index, i])
              }

              const isInGlobal = (index: number) =>
                globalRanges.some(([start, end]) => index >= start && index < end)

              let processed = src.replace(
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
                  const hashedName = `${prefix ? `${prefix}-` : ""}${className}`;
                  cssModule.classMap[className] = hashedName;
                  return `.${hashedName}`;
                },
              )

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
    ],
  }, (error, result) => {
    if (error) {
      // console.error(error)
      throw new Error(`Less 代码编译失败: ${error.message}`)
    } else {
      cssModule.cssContent = result?.css
    }
  })

  return cssModule;
}

function extractFrameStyle(css: string): { width?: number } | undefined {
  const match = css.match(/:frame\s*\{([^}]*)\}/);
  if (!match) return undefined;

  const block = match[1];
  // 仅匹配纯 px 整数/小数，排除 min-width / max-width 以及 %、auto、fit-content 等非 px 值
  const widthMatch = block.match(/(?<![a-z-])width:\s*(\d+(?:\.\d+)?)px\b/);

  if (!widthMatch) return undefined;

  return { width: Number(widthMatch[1]) };
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

async function loadLess() {
  if (window?.less) {
    return
  }
  await requireFromCdn('https://f2.beckwai.com/udata/pkg/eshop/fangzhou/asset/less/4.2.0/less.js')
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