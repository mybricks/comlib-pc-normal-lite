import { calculate, compare } from 'specificity';
import context from '../../../context'
import { getShadowRoot } from '../../../../helpers/designer'
import { convertCamelToHyphen } from '../../../../utils/string'
import { parseLess, stringifyLess } from '../../../utils/transform/less';
import { undoRedoManager } from '../../undoRedo'

const SETSTYLE_CSS_ID = "SETSTYLE_CSS_ID"

// gap 相关属性：由三方组件 size/gap prop 内部控制，无法通过 CSS 修改，需交 AI 处理
const GAP_KEYS = new Set(['gap', 'columnGap', 'rowGap'])

// gap 简写展开表（camelCase），用于检测平铺规则中与嵌套路径写入产生的级联冲突
const GAP_SHORTHAND_TO_LONGHANDS: Record<string, string[]> = {
  gap: ['rowGap', 'columnGap'],
}
const GAP_LONGHAND_TO_SHORTHAND: Record<string, string> = {
  rowGap: 'gap',
  columnGap: 'gap',
}

/**
 * 当编辑器将属性写入嵌套规则后，检查是否存在同选择器的平铺规则（源码靠后、CSS 级联优先级更高）。
 * 若平铺规则中存在与写入属性冲突的简写（如 gap 覆盖 column-gap），则展开该简写：
 *   - 删除简写属性
 *   - 将其余分量以原值写回平铺规则（避免 row-gap 等丢失）
 * 这样嵌套规则中刚写入的 longhand 就不再被平铺规则的 shorthand 覆盖。
 */
function clearFlatRuleConflicts(
  cssObj: Record<string, any>,
  classPath: string[],
  writtenProps: string[],
): void {
  if (classPath.length < 2) return
  const flatKey = classPath.join(' ')
  const flatRule = cssObj[flatKey]
  if (!flatRule || typeof flatRule !== 'object') return

  writtenProps.forEach(propKey => {
    // 情形 1：平铺规则直接含有与写入同名属性 → 直接删除，嵌套规则的值将生效
    // （相同选择器、相同特异性，嵌套规则在前、平铺规则在后，
    //  若平铺规则也有该属性会覆盖嵌套规则；删除后嵌套规则的值独立生效）
    // 注意：此处不删除，因为平铺规则靠后仍然胜出。
    // 正确做法是处理 情形 2（简写覆盖 longhand）。

    // 情形 2：平铺规则含有覆盖 propKey 的简写（如 gap 覆盖 columnGap）→ 展开简写
    const shorthand = GAP_LONGHAND_TO_SHORTHAND[propKey]
    if (shorthand && shorthand in flatRule) {
      const shorthandVal = flatRule[shorthand]
      delete flatRule[shorthand]
      // 将简写的其他分量以原值写回，避免 row-gap 等意外丢失
      GAP_SHORTHAND_TO_LONGHANDS[shorthand].forEach(lh => {
        if (lh !== propKey && flatRule[lh] == null) {
          flatRule[lh] = shorthandVal
        }
      })
    }

    // 情形 3：写入的是 gap 简写本身，平铺规则也有 gap → 直接删除平铺规则的 gap
    // （嵌套规则写入 gap 后，平铺规则同名 gap 靠后仍覆盖；删除后嵌套规则胜出）
    if (propKey === 'gap' && 'gap' in flatRule) {
      delete flatRule['gap']
    }
  })
}

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
   * - needsAI: 样式由三方组件 prop 控制（非 CSS/JSX style），需交由 AI 修改源码
   */
  let styleKeyRoutes: Record<string, { selector: string; isJsx: boolean; loc?: { start: number; end: number }; needsAI?: boolean }> = {}

  return function handler(ctx: any, params: any) {
    const { state } = params
    try {
      if (state === 'start') {

      } else if (state === 'ing' || state === 'moving') { // [引擎兼容处理] state传参未统一
        style = getStyle(ctx, params)

        if (!isStart) {
          const sourceEle = getEle(ctx, params)
          ele = resolveTargetEle(sourceEle, style)
          const componentID = context.component!.params.id
          // styleID 计算规则与 runtime-card.tsx 中 css.set 保持一致：
          // `${componentID}_${lessFile}`.replace(/\./g, '__').replace(/\//g, '_')
          // ele 是 resolveTargetEle 后的目标（gap 场景下为 parent），data-loc 在 ele 上，fallback 到 sourceEle
          const locRaw = ele.dataset?.loc ?? sourceEle.dataset?.loc
          const loc = locRaw ? (() => { try { return JSON.parse(locRaw) } catch { return null } })() : null
          const lessFile: string = loc?.files?.less ?? 'style.less'
          const styleID = `${componentID}_${lessFile}`.replace(/\./g, '__').replace(/\//g, '_')
          const shadowRoot = getShadowRoot()
          const styleTag = shadowRoot.querySelector(`#${styleID}`) as HTMLStyleElement | null
          const sheet = styleTag?.sheet ?? null
          // styleTag 或 sheet 未就绪时跳过本次，等下次 ing 再试
          if (!sheet) return
          isStart = true
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
          let winningRule: CSSStyleRule
          if (matchedRules[0]) {
            winningRule = matchedRules[0]
          } else {
            // Less 编译时空规则会被省略，sheet 里找不到该 class 的规则。
            // 回退：从 classList 里找 CSS Module 前缀类（含 '--'），构造合成选择器
            const moduleClass = [...ele.classList].find(c => c.includes('--'))
            if (!moduleClass) return
            const syntheticSelector = `:where(.${componentID}) .${moduleClass}`
            winningRule = { selectorText: syntheticSelector, style: { getPropertyValue: () => '' } } as unknown as CSSStyleRule
          }

          // ── 解析 data-style-info，决定每个 key 路由到哪个选择器 ───────────────
          type StyleKeyInfo = { kind: 'static' | 'dynamic'; valueStart: number; valueEnd: number }
          const styleInfoRaw = ele.dataset.styleInfo
          const styleInfo: Record<string, StyleKeyInfo> | null = styleInfoRaw
            ? (() => { try { return JSON.parse(styleInfoRaw) } catch { return null } })()
            : null

          // 目标元素是否来自三方库组件（data-library-source 由 babelPlugin 写入）
          const isLibraryElement = !!ele.dataset.librarySource

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
              const ownerCssRule = matchedRules.find(
                (rule) => rule.style.getPropertyValue(cssProp) !== ''
              )
              // 若三方库组件 + 用户 Less 中无该属性的规则 + 属于 gap 属性，说明间距由组件 prop 控制，交给 AI
              if (isLibraryElement && !ownerCssRule && GAP_KEYS.has(key)) {
                styleKeyRoutes[key] = { selector: '', isJsx: false, needsAI: true }
              } else {
                styleKeyRoutes[key] = { selector: (ownerCssRule ?? winningRule).selectorText, isJsx: false }
              }
            }
          })

        }

        // 将各 key 按目标选择器分组，拼成若干段 CSS 规则（needsAI 的 key 跳过预览）
        const selectorStyleMap = new Map<string, Record<string, { value: number; isJsx: boolean }>>()
        Object.entries(style as Record<string, number>).forEach(([key, val]) => {
          const route = styleKeyRoutes[key]
          if (!route || route.needsAI) return
          const selector = route.selector
          if (!selectorStyleMap.has(selector)) selectorStyleMap.set(selector, {})
          selectorStyleMap.get(selector)![key] = { value: val, isJsx: route?.isJsx ?? false }
        })
        const cssText = Array.from(selectorStyleMap.entries())
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

        Object.entries(styleKeyRoutes).forEach(([key, { isJsx, selector, loc, needsAI }]) => {
          if (needsAI) return  // 交给 AI，不写入 JSX/Less
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
          lessStyle.forEach((value, selectorKey) => {
            // 移除 :where(...) 前缀，剩余部分由空格分隔的多个模块 class token 组成
            // 例：":where(.u_Dt_Si) .mod--gridCard .mod--topGrid" → ".mod--gridCard .mod--topGrid"
            const withoutWhere = selectorKey.replace(/^:where\([^)]*\)\s*/, '')
            const tokens = withoutWhere.split(/\s+/).filter(Boolean)
            if (!tokens.length) return

            // 每个 token 形如 ".pages_StoreDashboard_index__module__less--topGrid"
            // 去掉前导 dot，在 "--" 处分割，还原文件路径和 class 名
            const parsed = tokens.map(token => {
              const clean = token.replace(/^\./, '')
              const dashIdx = clean.indexOf('--')
              if (dashIdx === -1) return null
              const fileRaw = clean.slice(0, dashIdx)
              const className = clean.slice(dashIdx + 2)
              const fileName = fileRaw.replace(/__/g, '.').replace(/_/g, '/')
              return { fileName, className }
            }).filter(Boolean) as { fileName: string; className: string }[]

            if (!parsed.length) return

            const fileName = parsed[0].fileName
            // Less 嵌套路径：['.gridCard', '.topGrid']
            const classPath = parsed.map(p => `.${p.className}`)

            const lessFile = context.component!.params.data.files.find((f) => f.fileName === fileName)
            if (!lessFile) return
            const lessPreviousCode = decodeURIComponent(lessFile.source)
            const cssObj = parseLess(lessPreviousCode)

            // 按 classPath 逐层导航嵌套的 cssObj，最后一层写入属性
            let target = cssObj
            for (let i = 0; i < classPath.length - 1; i++) {
              if (!target[classPath[i]] || typeof target[classPath[i]] !== 'object') {
                target[classPath[i]] = {}
              }
              target = target[classPath[i]]
            }
            const targetKey = classPath[classPath.length - 1]
            if (!target[targetKey] || typeof target[targetKey] !== 'object') {
              target[targetKey] = {}
            }

            value.forEach(({ key: propKey, value: propVal }) => {
              target[targetKey][propKey] = `${propVal}px`
            })

            // 写完嵌套路径后，清理平铺规则中可能覆盖上述属性的简写冲突
            clearFlatRuleConflicts(cssObj, classPath, value.map(v => v.key))

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

        // 处理 needsAI 的 key：间距由三方组件 prop 控制，交给 AI 修改源码
        const aiKeys = Object.entries(styleKeyRoutes)
          .filter(([, route]) => route.needsAI)
          .map(([key]) => ({ key, value: (style as Record<string, number>)[key] }))

        if (aiKeys.length > 0) {
          try {
            const loc = JSON.parse(ele.dataset.loc ?? '{}')
            const jsxFileName: string = loc?.files?.jsx
            const lineStart: number = loc?.codeLine?.start
            const lineEnd: number = loc?.codeLine?.end

            let codeSnippet = ''
            if (jsxFileName) {
              const jsxFile = context.component!.params.data.files.find((f: any) => f.fileName === jsxFileName)
              if (jsxFile) {
                const lines = decodeURIComponent(jsxFile.source).split('\n')
                codeSnippet = lines
                  .slice(Math.max(0, lineStart - 3), Math.min(lines.length, lineEnd + 2))
                  .join('\n')
              }
            }

            const styleDesc = aiKeys
              .map(({ key, value }) => `${convertCamelToHyphen(key)}: ${value}px`)
              .join('，')

            const message = [
              `用户通过可视化拖拽调整了组件间距，目标样式为：${styleDesc}。`,
              `但该间距由组件 prop 控制（非 CSS），无法直接写入 Less，需要修改 JSX 源码中的对应 prop。`,
              jsxFileName ? `请修改文件 \`${jsxFileName}\` 第 ${lineStart}~${lineEnd} 行附近的代码，将控制间距的 prop 改为对应新值。` : '',
              codeSnippet ? `\n相关代码片段：\n\`\`\`tsx\n${codeSnippet}\n\`\`\`` : '',
            ].filter(Boolean).join('\n')

            const plugins = (context as any).plugins as any
            plugins?.showAIDialog?.()
            plugins?.aiService?.request({ message, attachments: [] })
          } catch (e) {
            console.error('[createSetStyleHandler] AI request failed:', e)
          }
        }

        ctx.css.remove(SETSTYLE_CSS_ID)
      }
    } catch (e) {
      console.error(e)
    }
  }
}
