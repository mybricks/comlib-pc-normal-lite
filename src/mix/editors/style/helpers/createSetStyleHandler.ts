import { calculate, compare } from 'specificity';
import context from '../../../context'
import { getShadowRoot } from '../../../../helpers/designer'
import { convertCamelToHyphen } from '../../../../utils/string'
import { parseLess, stringifyLess } from '../../../utils/transform/less';
import { undoRedoManager } from '../../undoRedo'
import {
  appendToInlineStyleAttr,
  appendToInlineStyleAttrByTagRange,
  injectStyleAttrIntoJSX,
  patchJsxInlineStyle,
  StyleInfoEntry,
} from './patchJsxInlineStyle'

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

const hasGapStyle = (style: Record<string, number>) => {
  return 'rowGap' in style || 'columnGap' in style || 'gap' in style
}

const resolveTargetEle = (ele: HTMLElement, style: Record<string, number>, multiple?: boolean) => {
  if (hasGapStyle(style) && multiple) {
    const parent = ele.parentElement!
    // if (parent.dataset['customComWrapper']) {
    //   return parent.parentElement
    // }
    return parent
  }
  return ele
}

const resolveStyle = (style: Record<string, number>, multiple?: boolean) => {
  if (multiple || !hasGapStyle(style)) return style

  return Object.entries(style).reduce<Record<string, number>>((nextStyle, [key, value]) => {
    if (key === 'rowGap') {
      nextStyle.marginTop = value
    } else if (key === 'columnGap') {
      nextStyle.marginLeft = value
    } else if (key === 'gap') {
      nextStyle.marginTop = value
      nextStyle.marginLeft = value
    } else {
      nextStyle[key] = value
    }
    return nextStyle
  }, {})
}

type StyleKeyInfo = { kind: 'static' | 'dynamic'; valueStart?: number; valueEnd?: number }
type InitialInlineStyleValue = {
  hadInitialValue: boolean;
  initialValue: string;
}
type InlineStyleSnapshot = {
  ele: HTMLElement;
  cssProp: string;
  hadInitialValue: boolean;
  initialValue: string;
  nextValue: string;
}
type InlineSyncTarget = {
  ele: HTMLElement;
  fileName: string;
  loc: { start: number; end: number };
  initialValue: number;
  initialInlineValue: string;
  hadInitialInlineValue: boolean;
}
type LessStyleMap = Map<string, Array<{ key: string; value: number }>>
type FileUpdate = {
  fileName: string;
  previousCode: string;
  newCode: string;
}

type StyleKeyRoute = {
  selector: string;
  isJsx: boolean;
  loc?: { start: number; end: number };
  needsAI?: boolean;
  source?: 'jsx-inline' | 'less';
  /** selectorText 在当前 shadowRoot 下实际命中的 DOM 数量，用于判断写 Less 是否只影响单个 DOM */
  matchedElementCount?: number;
  /** 拖拽开始前，当前 DOM 元素该属性的实际数值，用于计算 delta */
  initialValue?: number;
  /** 拖拽开始前，Less 规则里该属性的数值；inline + multiple 时 Less 按该值叠加 delta */
  lessInitialValue?: number;
  /** inline + multiple 时，除了写 Less，还需要保留并更新当前 JSX inline style */
  syncInline?: boolean;
  /** multiple 模式下，同选择器命中的其他静态 JSX inline style 也需要按 delta 同步，避免覆盖 Less */
  inlineSyncTargets?: InlineSyncTarget[];
}

const getInitialInlineStyleSnapshot = (
  targetEle: HTMLElement,
  key: string,
  nextValue: string,
  initial?: InitialInlineStyleValue,
): InlineStyleSnapshot => {
  const cssProp = convertCamelToHyphen(key)
  const initialValue = initial?.initialValue ?? targetEle.style.getPropertyValue(cssProp)
  return {
    ele: targetEle,
    cssProp,
    hadInitialValue: initial?.hadInitialValue ?? initialValue !== '',
    initialValue,
    nextValue,
  }
}

const applyInlineStyleSnapshots = (snapshots: InlineStyleSnapshot[], phase: 'execute' | 'undo') => {
  snapshots.forEach((snapshot) => {
    if (phase === 'execute') {
      snapshot.ele.style.setProperty(snapshot.cssProp, snapshot.nextValue)
      return
    }

    if (snapshot.hadInitialValue) {
      snapshot.ele.style.setProperty(snapshot.cssProp, snapshot.initialValue)
    } else {
      snapshot.ele.style.removeProperty(snapshot.cssProp)
    }
  })
}

const parseJSON = <T = any>(raw?: string | null): T | null => {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

const appendPropsToExistingInlineStyle = (
  source: string,
  loc: any,
  styleInfo: Record<string, StyleKeyInfo> | null | undefined,
  propsToAdd: Record<string, string>,
) => {
  const appendResult = styleInfo
    ? appendToInlineStyleAttr(source, styleInfo as Record<string, StyleInfoEntry>, propsToAdd)
    : null
  if (appendResult) return appendResult

  const jsxStart: number | undefined = loc?.jsx?.start
  const tagEnd: number | undefined = loc?.tag?.end
  if (jsxStart == null || tagEnd == null) return null
  return appendToInlineStyleAttrByTagRange(source, jsxStart, tagEnd, propsToAdd)
}

const getJsxFileInfo = (targetEle: HTMLElement) => {
  const loc = parseJSON<any>(targetEle.dataset.loc)
  const fileName: string | undefined = loc?.files?.jsx
  if (!fileName) return null
  const file = context.component!.params.data.files.find((f: any) => f.fileName === fileName)
  if (!file) return null
  return {
    fileName,
    loc,
    previousCode: decodeURIComponent(file.source),
  }
}

const stringifyStyleValue = (value: string | number) => `${value}px`

const parseNumericStyleValue = (value?: string | null): number | null => {
  if (!value) return null
  const matched = String(value).trim().match(/^-?\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : null
}

const getElementNumericStyleValue = (targetEle: HTMLElement, key: string): number => {
  const cssProp = convertCamelToHyphen(key)
  return parseNumericStyleValue(targetEle.style.getPropertyValue(cssProp))
    ?? parseNumericStyleValue(getComputedStyle(targetEle).getPropertyValue(cssProp))
    ?? 0
}

const getRuleNumericStyleValue = (sheet: CSSStyleSheet, selector: string, key: string): number => {
  const cssProp = convertCamelToHyphen(key)
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSStyleRule)) continue
    if (rule.selectorText !== selector) continue
    const val = parseNumericStyleValue(rule.style.getPropertyValue(cssProp))
    if (val != null) return val
  }
  return 0
}

const getSelectorMatchedElements = (selector: string, shadowRoot: ShadowRoot): HTMLElement[] | null => {
  try {
    return Array.from(shadowRoot.querySelectorAll(selector)).filter((matchedEle): matchedEle is HTMLElement => matchedEle instanceof HTMLElement)
  } catch {
    return null
  }
}

const isSingleDomLessRoute = (route?: StyleKeyRoute) => {
  return route?.source === 'less' && route.matchedElementCount === 1
}

const collectInlineSyncTargets = (
  selector: string,
  key: string,
  editedEle: HTMLElement,
  shadowRoot: ShadowRoot,
): InlineSyncTarget[] => {
  const targets: InlineSyncTarget[] = []
  let matchedElements: HTMLElement[] = []

  const queriedElements = getSelectorMatchedElements(selector, shadowRoot)
  if (!queriedElements) return targets
  matchedElements = queriedElements

  matchedElements.forEach((matchedEle) => {
    const styleInfo = parseJSON<Record<string, StyleKeyInfo>>(matchedEle.dataset.styleInfo)
    const info = styleInfo?.[key]
    if (info?.kind !== 'static' || info.valueStart == null || info.valueEnd == null) return

    const loc = parseJSON<any>(matchedEle.dataset.loc)
    const fileName: string | undefined = loc?.files?.jsx
    if (!fileName) return

    const initialInlineValue = matchedEle.style.getPropertyValue(convertCamelToHyphen(key))
    targets.push({
      ele: matchedEle,
      fileName,
      loc: { start: info.valueStart, end: info.valueEnd },
      initialValue: getElementNumericStyleValue(matchedEle, key),
      initialInlineValue,
      hadInitialInlineValue: initialInlineValue !== '',
    })
  })

  if (!targets.some(target => target.ele === editedEle)) {
    const editedStyleInfo = parseJSON<Record<string, StyleKeyInfo>>(editedEle.dataset.styleInfo)
    const editedInfo = editedStyleInfo?.[key]
    const editedLoc = parseJSON<any>(editedEle.dataset.loc)
    const editedFileName: string | undefined = editedLoc?.files?.jsx

    if (editedInfo?.kind === 'static' && editedInfo.valueStart != null && editedInfo.valueEnd != null && editedFileName) {
      const initialInlineValue = editedEle.style.getPropertyValue(convertCamelToHyphen(key))
      targets.push({
        ele: editedEle,
        fileName: editedFileName,
        loc: { start: editedInfo.valueStart, end: editedInfo.valueEnd },
        initialValue: getElementNumericStyleValue(editedEle, key),
        initialInlineValue,
        hadInitialInlineValue: initialInlineValue !== '',
      })
    }
  }

  return targets
}

const buildCssModuleSelectorFromLoc = (targetEle: HTMLElement, loc: any, componentID: string) => {
  const lessFile: string | undefined = loc?.files?.less
  const className: string | undefined = loc?.cn
  if (!lessFile || !className) return null
  const fileToken = lessFile.replace(/\./g, '__').replace(/\//g, '_')
  const moduleClass = [...targetEle.classList].find(c => c === `${fileToken}--${className}` || c.endsWith(`--${className}`))
  return `:where(.${componentID}) .${moduleClass ?? `${fileToken}--${className}`}`
}

const applyStyleInfoOffset = (
  styleInfo: Record<string, StyleKeyInfo>,
  replacements: Array<{ valueStart: number; valueEnd: number; newLen: number }>,
): Record<string, StyleKeyInfo> => {
  const nextInfo: Record<string, StyleKeyInfo> = JSON.parse(JSON.stringify(styleInfo))
  const sorted = [...replacements].sort((a, b) => a.valueStart - b.valueStart)
  let delta = 0

  sorted.forEach(({ valueStart, valueEnd, newLen }) => {
    const adjustedStart = valueStart + delta
    const shift = newLen - (valueEnd - valueStart)

    Object.values(nextInfo).forEach((entry) => {
      if (entry.kind !== 'static' || entry.valueStart == null || entry.valueEnd == null) return
      if (entry.valueStart === adjustedStart) {
        entry.valueEnd = adjustedStart + newLen
      } else if (entry.valueStart > adjustedStart) {
        entry.valueStart += shift
        entry.valueEnd += shift
      }
    })
    delta += shift
  })

  return nextInfo
}

const pushLessStyle = (lessStyle: LessStyleMap, selector: string, key: string, value: number) => {
  const lessValue = { key, value }
  if (!lessStyle.has(selector)) {
    lessStyle.set(selector, [lessValue])
  } else {
    lessStyle.get(selector)!.push(lessValue)
  }
}

const patchLessStyles = (lessStyle: LessStyleMap): FileUpdate[] => {
  const lesss: FileUpdate[] = []

  if (!lessStyle.size) return lesss

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

  return lesss
}

/**
 * multiple 为否时，样式只写当前 JSX 标签 inline style，避免修改共享 class 对应的 Less 规则。
 */
const patchSingleElementInlineStyle = (
  targetEle: HTMLElement,
  nextStyle: Record<string, number>,
  initialInlineCssText = '',
): { fileName: string; previousCode: string; newCode: string } | null => {
  const jsxInfo = getJsxFileInfo(targetEle)
  if (!jsxInfo) return null

  const styleInfo = parseJSON<Record<string, StyleKeyInfo>>(targetEle.dataset.styleInfo)
  const existingEntries: Array<{ key: string; val: string; valueStart: number; valueEnd: number }> = []
  const propsToAdd: Record<string, string> = {}

  Object.entries(nextStyle).forEach(([key, value]) => {
    const info = styleInfo?.[key]
    const val = stringifyStyleValue(value)
    if (info?.kind === 'static' && info.valueStart != null && info.valueEnd != null) {
      existingEntries.push({ key, val, valueStart: info.valueStart, valueEnd: info.valueEnd })
    } else {
      propsToAdd[key] = val
    }
  })

  let newCode = jsxInfo.previousCode
  let latestStyleInfo = styleInfo

  if (existingEntries.length > 0) {
    const patched = patchJsxInlineStyle(
      newCode,
      existingEntries.map(({ val, valueStart, valueEnd }) => ({
        val,
        valueStart,
        valueEnd,
        asString: true,
      })),
    )
    if (!patched) return null
    newCode = patched
    if (styleInfo) {
      latestStyleInfo = applyStyleInfoOffset(styleInfo, existingEntries.map(({ val, valueStart, valueEnd }) => {
        const escaped = val.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
        return { valueStart, valueEnd, newLen: `'${escaped}'`.length }
      }))
    }
  }

  const hasPropsToAdd = Object.keys(propsToAdd).length > 0
  if (hasPropsToAdd) {
    if (latestStyleInfo) {
      const appendResult = appendPropsToExistingInlineStyle(newCode, jsxInfo.loc, latestStyleInfo, propsToAdd)
      if (!appendResult) return null
      newCode = appendResult.newSource
    } else {
      // 没有 data-style-info 表示源码标签可能尚无静态 style 属性；若运行时已有 style，通常来自变量 style={x}，不能安全再注入一个 style 属性。
      if (initialInlineCssText) return null
      const tagEnd: number | undefined = jsxInfo.loc?.tag?.end
      if (tagEnd == null) return null
      const injectResult = injectStyleAttrIntoJSX(newCode, tagEnd, propsToAdd)
      if (!injectResult) return null
      newCode = injectResult.newSource
    }
  }

  if (newCode === jsxInfo.previousCode) return null
  return {
    fileName: jsxInfo.fileName,
    previousCode: jsxInfo.previousCode,
    newCode,
  }
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
  let initialInlineCssText = ''
  let initialInlineStyleValues: Record<string, InitialInlineStyleValue> = {}
  // state状态不靠谱，第一次ing认为是start
  let isStart = false

  /**
   * 记录每个 style key 在预览阶段应注入到哪个选择器。
   * - selector: 目标 CSS 选择器字符串
   * - isJsx: 是否为 JSX 内联 style（static），为 true 时用 !important 强制覆盖
   * - needsAI: 样式由三方组件 prop 控制（非 CSS/JSX style），需交由 AI 修改源码
   */
  let styleKeyRoutes: Record<string, StyleKeyRoute> = {}

  return function handler(ctx: any, params: any) {
    const { state, multiple } = params
    /**
     * multiple
     *  - true 批量修改样式
     *  - 否则 只修改当前元素样式
     */
    try {
      if (state === 'start') {

      } else if (state === 'ing' || state === 'moving') { // [引擎兼容处理] state传参未统一
        style = resolveStyle(getStyle(ctx, params), multiple)

        if (!isStart) {
          console.log('[style]', style)
          const sourceEle = getEle(ctx, params)
          console.log('[sourceEle]', sourceEle)
          ele = resolveTargetEle(sourceEle, style, multiple)
          initialInlineCssText = ele.style?.cssText ?? ''
          initialInlineStyleValues = {}
          Object.keys(style as Record<string, number>).forEach((key) => {
            const initialValue = ele.style.getPropertyValue(convertCamelToHyphen(key))
            initialInlineStyleValues[key] = {
              hadInitialValue: initialValue !== '',
              initialValue,
            }
          })
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
          const styleInfoRaw = ele.dataset.styleInfo
          const styleInfo: Record<string, StyleKeyInfo> | null = styleInfoRaw
            ? (() => { try { return JSON.parse(styleInfoRaw) } catch { return null } })()
            : null

          // 目标元素是否来自三方库组件（data-library-source 由 babelPlugin 写入）
          const isLibraryElement = !!ele.dataset.librarySource

          styleKeyRoutes = {}
          const locForSelector = loc ?? parseJSON<any>(ele.dataset?.loc)
          const lessSelectorFromLoc = buildCssModuleSelectorFromLoc(ele, locForSelector, componentID)

          Object.keys(style).forEach((key) => {
            const info = styleInfo?.[key]
            const inlineSyncTargets = multiple && lessSelectorFromLoc
              ? collectInlineSyncTargets(lessSelectorFromLoc, key, ele, shadowRoot)
              : []

            if (info) {
              if (info.kind === 'static' && info.valueStart != null && info.valueEnd != null) {
                const initialValue = getElementNumericStyleValue(ele, key)
                const lessInitialValue = lessSelectorFromLoc ? getRuleNumericStyleValue(sheet, lessSelectorFromLoc, key) : undefined
                const selector = lessSelectorFromLoc ?? winningRule.selectorText
                const matchedElementCount = getSelectorMatchedElements(selector, shadowRoot)?.length
                // JSX 内联 style：单元素模式继续写当前 JSX；批量模式同时更新当前 JSX inline 与 Less。
                // 这样当前元素保留个性化值，其他同 class 元素通过 Less 按同一 delta 变化。
                styleKeyRoutes[key] = {
                  selector,
                  isJsx: !lessSelectorFromLoc,
                  loc: {
                    start: info.valueStart,
                    end: info.valueEnd
                  },
                  source: 'jsx-inline',
                  initialValue,
                  lessInitialValue,
                  matchedElementCount,
                  syncInline: multiple && !!lessSelectorFromLoc,
                  inlineSyncTargets,
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
                const selector = (ownerCssRule ?? winningRule).selectorText
                const matchedElementCount = getSelectorMatchedElements(selector, shadowRoot)?.length
                const routeInlineSyncTargets = multiple
                  ? (selector === lessSelectorFromLoc
                    ? inlineSyncTargets
                    : collectInlineSyncTargets(selector, key, ele, shadowRoot))
                  : []
                styleKeyRoutes[key] = {
                  selector,
                  isJsx: false,
                  source: 'less',
                  initialValue: getElementNumericStyleValue(ele, key),
                  matchedElementCount,
                  inlineSyncTargets: routeInlineSyncTargets,
                }
              }
            }
          })

        }

        if (!multiple) {
          const lessOnlyStyleMap = new Map<string, Record<string, number>>()
          const inlineStyleEntries: Array<[string, number]> = []

          Object.entries(style as Record<string, number>).forEach(([key, val]) => {
            const route = styleKeyRoutes[key]
            if (isSingleDomLessRoute(route)) {
              if (!lessOnlyStyleMap.has(route!.selector)) lessOnlyStyleMap.set(route!.selector, {})
              lessOnlyStyleMap.get(route!.selector)![key] = val
            } else {
              inlineStyleEntries.push([key, val])
            }
          })

          inlineStyleEntries.forEach(([key, val]) => {
            ele.style.setProperty(convertCamelToHyphen(key), `${val}px`)
          })

          const cssText = Array.from(lessOnlyStyleMap.entries())
            .map(([selector, props]) => {
              const declarations = Object.entries(props)
                .map(([prop, value]) => `${convertCamelToHyphen(prop)}: ${value}px;`)
                .join(' ')
              return `${selector} { ${declarations} }`
            })
            .join('\n')

          if (cssText) {
            ctx.css.set(SETSTYLE_CSS_ID, cssText)
          } else {
            ctx.css.remove(SETSTYLE_CSS_ID)
          }
          return
        }

        // 将各 key 按目标选择器分组，拼成若干段 CSS 规则（needsAI 的 key 跳过预览）
        const selectorStyleMap = new Map<string, Record<string, { value: number; isJsx: boolean }>>()
        Object.entries(style as Record<string, number>).forEach(([key, val]) => {
          const route = styleKeyRoutes[key]
          if (!route || route.needsAI) return
          const selector = route.selector
          const cssProp = convertCamelToHyphen(key)
          let cssValue = val
          let isJsx = route.source === 'jsx-inline' || (route?.isJsx ?? false)

          if (route.source === 'jsx-inline' && route.syncInline) {
            const delta = val - (route.initialValue ?? 0)
            cssValue = (route.lessInitialValue ?? 0) + delta
            isJsx = false
            ;(route.inlineSyncTargets?.length ? route.inlineSyncTargets : [{ ele, initialValue: route.initialValue ?? 0 }]).forEach((target) => {
              target.ele.style.setProperty(cssProp, `${(target.initialValue ?? 0) + delta}px`)
            })
          } else if (route.source === 'less' && route.inlineSyncTargets?.length) {
            const delta = val - (route.initialValue ?? 0)
            route.inlineSyncTargets.forEach((target) => {
              target.ele.style.setProperty(cssProp, `${target.initialValue + delta}px`)
            })
          }

          if (!selectorStyleMap.has(selector)) selectorStyleMap.set(selector, {})
          selectorStyleMap.get(selector)![key] = { value: cssValue, isJsx }
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
        style = resolveStyle(getStyle(ctx, params) || style, multiple)

        if (!multiple) {
          const lessStyle: LessStyleMap = new Map()
          const inlineStyle: Record<string, number> = {}

          Object.entries(style as Record<string, number>).forEach(([key, value]) => {
            const route = styleKeyRoutes[key]
            if (isSingleDomLessRoute(route)) {
              pushLessStyle(lessStyle, route!.selector, key, value)
            } else {
              inlineStyle[key] = value
            }
          })

          const inlineUpdate = Object.keys(inlineStyle).length
            ? patchSingleElementInlineStyle(ele, inlineStyle, initialInlineCssText)
            : null
          const lessUpdates = patchLessStyles(lessStyle)
          const updateFIles = (inlineUpdate ? [inlineUpdate] : []).concat(lessUpdates)
          const inlineStyleSnapshots = inlineUpdate
            ? Object.entries(inlineStyle).map(([key, value]) => getInitialInlineStyleSnapshot(ele, key, stringifyStyleValue(value), initialInlineStyleValues[key]))
            : []

          if (updateFIles.length) {
            const filenames = updateFIles.map(f => f.fileName);
            undoRedoManager.execute({
              execute() {
                applyInlineStyleSnapshots(inlineStyleSnapshots, 'execute')
                updateFIles.forEach(({ fileName, newCode }) => {
                  const suffix = fileName.split('.').pop()!;
                  context.updateFile({ fileName, content: newCode, type: undefined, noUpdateFileSystem: ['jsx', 'tsx'].includes(suffix) });
                })
                context.saveManualVersion(filenames);
              },
              undo() {
                applyInlineStyleSnapshots(inlineStyleSnapshots, 'undo')
                updateFIles.forEach(({ fileName, previousCode }) => {
                  const suffix = fileName.split('.').pop()!;
                  context.updateFile({ fileName, content: previousCode, type: undefined, noUpdateFileSystem: ['jsx', 'tsx'].includes(suffix) });
                })
                context.saveManualVersion(filenames);
              },
            });
          }
          ctx.css.remove(SETSTYLE_CSS_ID)
          return
        }

        let jsxStyle: Array<{
          key: string;
          value: number;
          loc: { start: number; end: number };
          asString?: boolean;
          fileName?: string;
          ele?: HTMLElement;
          initialInlineValue?: string;
          hadInitialInlineValue?: boolean;
        }> = []
        let lessStyle: LessStyleMap = new Map()

        Object.entries(styleKeyRoutes).forEach(([key, route]) => {
          const { isJsx, selector, loc, needsAI } = route
          if (needsAI) return  // 交给 AI，不写入 JSX/Less
          const value = style[key]
          if (route.source === 'jsx-inline' && route.syncInline) {
            const delta = value - (route.initialValue ?? 0)
            const inlineTargets = route.inlineSyncTargets?.length
              ? route.inlineSyncTargets
              : loc
                ? [{
                  ele,
                  fileName: undefined,
                  loc,
                  initialValue: route.initialValue ?? value,
                  initialInlineValue: initialInlineStyleValues[key]?.initialValue ?? ele.style.getPropertyValue(convertCamelToHyphen(key)),
                  hadInitialInlineValue: initialInlineStyleValues[key]?.hadInitialValue ?? ele.style.getPropertyValue(convertCamelToHyphen(key)) !== '',
                }]
                : []

            inlineTargets.forEach((target) => {
              jsxStyle.push({
                key,
                value: target.initialValue + delta,
                loc: target.loc,
                asString: true,
                fileName: target.fileName,
                ele: target.ele,
                initialInlineValue: target.initialInlineValue,
                hadInitialInlineValue: target.hadInitialInlineValue,
              })
            })
            pushLessStyle(lessStyle, selector, key, (route.lessInitialValue ?? 0) + delta)
          } else if (route.source === 'less' && route.inlineSyncTargets?.length) {
            const delta = value - (route.initialValue ?? 0)
            route.inlineSyncTargets.forEach((target) => {
              jsxStyle.push({
                key,
                value: target.initialValue + delta,
                loc: target.loc,
                asString: true,
                fileName: target.fileName,
                ele: target.ele,
                initialInlineValue: target.initialInlineValue,
                hadInitialInlineValue: target.hadInitialInlineValue,
              })
            })
            pushLessStyle(lessStyle, selector, key, value)
          } else if (isJsx && loc) {
            jsxStyle.push({
              key,
              value,
              loc,
              ele
            })
          } else {
            pushLessStyle(lessStyle, selector, key, value)
          }
        })

        const jsxs: {
          fileName: string;
          previousCode: string;
          newCode: string;
        }[] = []

        const pushJsxUpdate = (update: { fileName: string; previousCode: string; newCode: string }) => {
          const existing = jsxs.find(item => item.fileName === update.fileName)
          if (existing) {
            existing.newCode = update.newCode
          } else {
            jsxs.push(update)
          }
        }

        if (jsxStyle.length) {
          const fallbackJsxFileName = parseJSON<any>(ele.dataset.loc)?.files?.jsx
          const jsxStyleByFile = new Map<string, typeof jsxStyle>()

          jsxStyle.forEach((entry) => {
            const fileName = entry.fileName ?? fallbackJsxFileName
            if (!fileName) return
            if (!jsxStyleByFile.has(fileName)) jsxStyleByFile.set(fileName, [])
            jsxStyleByFile.get(fileName)!.push(entry)
          })

          jsxStyleByFile.forEach((entries, jsxFileName) => {
            const jsxFile = context.component!.params.data.files.find((f) => f.fileName === jsxFileName)
            if (!jsxFile) return
            const jsxPreviousCode = decodeURIComponent(jsxFile.source)
            const jsxNewCode = patchJsxInlineStyle(
              jsxPreviousCode,
              entries.map((entry) => {
                return {
                  key: entry.key,
                  val: entry.asString ? stringifyStyleValue(entry.value) : entry.value,
                  valueStart: entry.loc.start,
                  valueEnd: entry.loc.end,
                  asString: entry.asString,
                }
              })
            )

            if (!jsxNewCode) return

            pushJsxUpdate({
              fileName: jsxFileName,
              previousCode: jsxPreviousCode,
              newCode: jsxNewCode
            })
          })
        }

        const lesss = patchLessStyles(lessStyle)
        const jsxInlineStyleSnapshots = jsxStyle
          .filter((entry): entry is typeof entry & { ele: HTMLElement } => !!entry.ele)
          .map((entry) => getInitialInlineStyleSnapshot(
            entry.ele,
            entry.key,
            stringifyStyleValue(entry.value),
            entry.initialInlineValue !== undefined && entry.hadInitialInlineValue !== undefined
              ? {
                initialValue: entry.initialInlineValue,
                hadInitialValue: entry.hadInitialInlineValue,
              }
              : undefined,
          ))

        const updateFIles = jsxs.concat(lesss)

        if (updateFIles.length) {
          const filenames = updateFIles.map(f => f.fileName);
          undoRedoManager.execute({
            execute() {
              applyInlineStyleSnapshots(jsxInlineStyleSnapshots, 'execute')
              updateFIles.forEach(({ fileName, newCode }) => {
                const suffix = fileName.split('.').pop()!;
                context.updateFile({ fileName, content: newCode, type: undefined, noUpdateFileSystem: ['jsx', 'tsx'].includes(suffix) });
              })
              context.saveManualVersion(filenames);
            },
            undo() {
              applyInlineStyleSnapshots(jsxInlineStyleSnapshots, 'undo')
              updateFIles.forEach(({ fileName, previousCode }) => {
                const suffix = fileName.split('.').pop()!;
                context.updateFile({ fileName, content: previousCode, type: undefined, noUpdateFileSystem: ['jsx', 'tsx'].includes(suffix) });
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
