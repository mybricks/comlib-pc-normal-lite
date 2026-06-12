import { calculate, compare } from 'specificity';
import context from '../../../context'
import { getShadowRoot } from '../../../../helpers/designer'
import { convertCamelToHyphen } from '../../../../utils/string'
import { parseLess, stringifyLess } from '../../../utils/transform/less';
import { undoRedoManager } from '../../undoRedo'

const SETSTYLE_CSS_ID = "SETSTYLE_CSS_ID"

const resolveTargetEle = (ele: HTMLElement, style: Record<string, number>) => {
  const hasGap = 'rowGap' in style || 'columnGap' in style || 'gap' in style
  if (hasGap) {
    const parent = ele.parentElement!
    if (parent.dataset['customComWrapper']) {
      return parent.parentElement
    }
    return parent
  }
  return ele
}

/**
 * 将一组静态 style 键值直接替换到 JSX/TSX 源码中。
 * 利用 data-style-info 中记录的 valueStart/valueEnd 字符偏移，
 * 从后向前替换，避免偏移量因前面内容长度变化而失效。
 *
 * @returns 替换后的新源码字符串，若无法定位则返回 null
 */
function patchStyleInTsx(
  source: string,
  styleEntries: Array<{ key: string; val: number; valueStart: number; valueEnd: number }>,
): string | null {
  if (styleEntries.length === 0) return null

  // 按 valueStart 从大到小排序，从后向前替换，保证偏移量不受前面替换影响
  const sorted = [...styleEntries].sort((a, b) => b.valueStart - a.valueStart)

  let result = source
  for (const { val, valueStart, valueEnd } of sorted) {
    if (valueStart < 0 || valueEnd > result.length || valueStart >= valueEnd) return null
    const newVal = `${val}`
    result = result.slice(0, valueStart) + newVal + result.slice(valueEnd)
  }
  return result
}

/**
 * 构造一个处理 start / ing / finish 三态的样式拖拽处理器。
 *
 * @param getEle       从调用参数中提取目标 DOM 元素
 * @param getStyle     从调用参数中提取当前样式对象
 */
export default function createSetStyleHandler(
  getEle: (ctx: any, params: any) => HTMLElement,
  getStyle: (ctx: any, params: any) => Record<string, number>,
) {
  // [引擎兼容处理] start、finish状态可能没有style，在ing阶段进行收集
  let style = {}
  let ele
  // state状态不靠谱，第一次ing认为是start
  let isStart = false

  /**
   * 记录每个 style key 在预览阶段应注入到哪个选择器。
   * - selector: 目标 CSS 选择器字符串
   * - isJsx: 是否为 JSX 内联 style（static），为 true 时用 !important 强制覆盖
   */
  let styleKeyRoutes: Record<string, { selector: string; isJsx: boolean, loc?: { start: number, end: number } }> = {}

  return function handler(ctx: any, params: any) {
    const { state } = params

    try {
      if (state === 'start') {

      } else if (state === 'ing' || state === 'moving') { // [引擎兼容处理] state传参未统一
        style = getStyle(ctx, params)

        if (!isStart) {
          isStart = true
          ele = resolveTargetEle(getEle(ctx, params), style)
          // [TODO] 处理多个classname的情况
          const result = ele.className.replace(/--.*$/, '');
          const componentID = context.component!.params.id
          const styleID = `${componentID}_${result}`
          const shadowRoot = getShadowRoot()
          const styleTag = shadowRoot.querySelector(`#${styleID}`) as HTMLStyleElement
          const sheet = styleTag.sheet!
          const matchedRules: CSSStyleRule[] = [];
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSStyleRule) {
              try {
                // 用 el.matches() 判断选择器是否匹配当前元素
                if (ele.matches(rule.selectorText)) {
                  matchedRules.push(rule);
                }
              } catch {/** 某些伪类选择器 matches() 会报错，忽略 */}
            }
          }
          matchedRules.sort((a, b) => {
            // b 在前，a 在后 → 权重高的排到索引 0
            const cmp = compare(calculate(b.selectorText), calculate(a.selectorText));
            if (cmp !== 0) return cmp;
            // specificity 相同时，source order 靠后的优先（index 越大越靠后）
            return 0; // stable sort 下 push 顺序即书写顺序，同权重保持原序
          })
          const winningRule = matchedRules[0]

          // ── 解析 data-style-info，决定每个 key 路由到哪个选择器 ───────────────
          type StyleKeyInfo = { kind: 'static' | 'dynamic'; valueStart: number; valueEnd: number }
          const styleInfoRaw = ele.dataset.styleInfo
          const styleInfo: Record<string, StyleKeyInfo> | null = styleInfoRaw
            ? (() => { try { return JSON.parse(styleInfoRaw) } catch { return null } })()
            : null

          styleKeyRoutes = {}
          Object.keys(style).forEach((key) => {
            const info = styleInfo?.[key]

            if (info) {
              if (info.kind === 'static') {
                // JSX 内联 style：统一挂到 winningRule 选择器，用 !important 强制覆盖
                styleKeyRoutes[key] = {
                  selector: winningRule.selectorText,
                  isJsx: true,
                  loc: {
                    start: info.valueStart,
                    end: info.valueEnd
                  }
                }
              } else {
                // [TODO] 动态的，走 AI ?
              }
            } else {
              // CSS rule：从 matchedRules 中找第一个已声明该属性的 rule
              const cssProp = convertCamelToHyphen(key)
              const ownerRule = matchedRules.find(
                (rule) => rule.style.getPropertyValue(cssProp) !== ''
              ) ?? winningRule
              styleKeyRoutes[key] = { selector: ownerRule.selectorText, isJsx: false }
            }
          })
        }

        // 将各 key 按目标选择器分组，拼成若干段 CSS 规则
        let cssText: string
        const selectorStyleMap = new Map<string, Record<string, { value: number; isJsx: boolean }>>()
        Object.entries(style as Record<string, number>).forEach(([key, val]) => {
          const route = styleKeyRoutes[key]
          const selector = route.selector
          if (!selectorStyleMap.has(selector)) selectorStyleMap.set(selector, {})
          selectorStyleMap.get(selector)![key] = { value: val, isJsx: route?.isJsx ?? false }
        })
        cssText = Array.from(selectorStyleMap.entries())
          .map(([selector, props]) => {
            const declarations = Object.entries(props)
              .map(([prop, { value, isJsx }]) => {
                const cssProp = convertCamelToHyphen(prop)
                return `${cssProp}: ${value}px${isJsx ? ' !important' : ''};`
              })
              .join(' ')
            return `${selector} { ${declarations} }`
          })
          .join('\n')
        ctx.css.set(SETSTYLE_CSS_ID, cssText)
      } else if (state === 'finish') {
        isStart = false
        style = getStyle(ctx, params) || style

        let jsxStyle = new Map()
        let lessStyle = new Map()

        Object.entries(styleKeyRoutes).forEach(([key, { isJsx, selector, loc }]) => {
          const value = style[key]
          if (isJsx) {
            jsxStyle.set(key, {
              value,
              loc
            })
          } else {
            const lessValue = { key, value: value }
            if (!lessStyle.has(selector)) {
              lessStyle.set(selector, [lessValue])
            } else {
              lessStyle.get(selector).push(lessValue)
            }
          }
        })

        const jsxs: {
          fileName: string;
          previousCode: string;
          newCode: string;
        }[] = []

        if (jsxStyle.size) {
          const jsxFileName = JSON.parse(ele.dataset.loc).files.jsx
          const jsxFile = context.component!.params.data.files.find((f) => f.fileName === jsxFileName)
          const jsxPreviousCode = decodeURIComponent(jsxFile.source)
          const jsxNewCode = patchStyleInTsx(
            jsxPreviousCode,
            Array.from(jsxStyle.entries()).map(([key, value]) => {
              return {
                key,
                val: value.value,
                valueStart: value.loc.start,
                valueEnd: value.loc.end,
              }
            })
          )!

          jsxs.push({
            fileName: jsxFileName,
            previousCode: jsxPreviousCode,
            newCode: jsxNewCode
          })
        }

        const lesss: {
          fileName: string;
          previousCode: string;
          newCode: string;
        }[] = []

        if (lessStyle.size) {
          // [TODO] 处理多className的情况
          lessStyle.forEach((value, key) => {
            let cssKey = key
              .replace(/^:where\([^)]*\)\s*/, '')
              .replace(/^./, '')
              .replace(/__/g, '.').replace(/_/g, '/');

            const [fileName, ...cssKeys] = cssKey.split('--')
            cssKey = `.${cssKeys.join('--')}`
            const lessFile = context.component!.params.data.files.find((f) => f.fileName === fileName)
            const lessPreviousCode = decodeURIComponent(lessFile.source)
            const cssObj = parseLess(lessPreviousCode)
            value.forEach(({ key, value }) => {
              cssObj[cssKey][key] = `${value}px`
            })
            const lessNewCode = stringifyLess(cssObj)
            lesss.push({
              fileName,
              previousCode: lessPreviousCode,
              newCode: lessNewCode
            })
          })
        }

        const updateFIles = jsxs.concat(lesss)

        if (updateFIles.length) {
          const filenames = updateFIles.map(f => f.fileName);
          undoRedoManager.execute({
            execute() {
              updateFIles.forEach(({ fileName, newCode }) => {
                context.updateFile({ fileName, content: newCode, type: undefined });
              })
              context.saveManualVersion(filenames);
            },
            undo() {
              updateFIles.forEach(({ fileName, previousCode }) => {
                context.updateFile({ fileName, content: previousCode, type: undefined });
              })
              context.saveManualVersion(filenames);
            },
          });
        }

        ctx.css.remove(SETSTYLE_CSS_ID)
      }
    } catch (e) {
      console.error(e)
    }
  }
}
