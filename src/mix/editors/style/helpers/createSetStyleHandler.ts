import { calculate, compare } from 'specificity';
import context, { config } from '../../../context'
import { getShadowRoot } from '../../../../helpers/designer'
import { convertCamelToHyphen } from '../../../../utils/string'
import { parseLess, stringifyLess } from '../../../utils/transform/less';
import { undoRedoManager } from '../../undoRedo'
import { randomUUID } from '../../../utils/uuid'
import { buildElementStyleUpdateChipData, getElementLabel } from '../../setSegment/elementChip'
import {
  createDOMSourceLocationSnapshot,
  restoreDOMSourceLocationSnapshot,
  shiftDOMSourceLocationsAfterReplacement,
  type SourceReplacement,
} from '../../setSegment/sourceLocation'
import {
  appendToInlineStyleAttr,
  appendToInlineStyleAttrByTagRange,
  injectStyleAttrIntoJSX,
  patchJsxInlineStyle,
  StyleInfoEntry,
} from './patchJsxInlineStyle'
import { resolveLessFilePath } from './resolveLessFilePath'

const getStyleActionTitle = (ele: HTMLElement) => {
  const label = getElementLabel(ele, '节点1')
  return `调整 ${label} 样式`
}

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

/**
 * 拖拽引擎在单元素模式下返回的 gap 类样式值 = 实际 margin + parent gap，
 * 因此需要从原始样式值中减去 parent 的 gap，得到真正应写入的 margin 值。
 * - 横向（columnGap）减去 parent 的 column-gap
 * - 纵向（rowGap）减去 parent 的 row-gap
 * - 简写 gap 展开为 rowGap/columnGap 分别减去对应分量
 *
 * 仅在 multiple=false 时需要处理（multiple 模式下直接写 parent 的 gap 属性，值本身是正确的）。
 */
const subtractParentGapFromStyle = (
  rawStyle: Record<string, number>,
  sourceEle: HTMLElement | null,
): Record<string, number> => {
  if (!sourceEle?.parentElement) return rawStyle
  if (!hasGapStyle(rawStyle)) return rawStyle

  const parent = sourceEle.parentElement
  const computed = window.getComputedStyle(parent)
  const colGap = parseFloat(computed.columnGap) || 0
  const rowGap = parseFloat(computed.rowGap) || 0

  if (colGap === 0 && rowGap === 0) return rawStyle

  const result = { ...rawStyle }
  if ('columnGap' in result) result.columnGap = result.columnGap - colGap
  if ('rowGap' in result) result.rowGap = result.rowGap - rowGap
  if ('gap' in result) {
    // gap 同时覆盖两个方向：展开为 rowGap/columnGap 后分别减去对应 parent gap
    const gapVal = result.gap
    delete result.gap
    result.rowGap = gapVal - rowGap
    result.columnGap = gapVal - colGap
  }

  return result
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
type CssRuleStyleSnapshot = {
  rule: CSSStyleRule;
  cssProp: string;
  hadInitialValue: boolean;
  initialValue: string;
  initialPriority: string;
}
type InlineSyncTarget = {
  ele: HTMLElement;
  fileName: string;
  loc: { start: number; end: number };
  initialValue: number;
  initialInlineValue: string;
  hadInitialInlineValue: boolean;
}
type SelectorMatchStats = {
  /** selectorText 在当前 shadowRoot 下实际命中的 DOM 数量 */
  elementCount?: number;
  /** 命中 DOM 去重后的源码 JSX 位置数量；map 渲染出来的多个 DOM 通常只有 1 个源码位置 */
  sourceLocationCount?: number;
}
type StyleValue = string | number
type LessStyleMap = Map<string, Array<{ key: string; value: StyleValue }>>
type FileUpdate = {
  fileName: string;
  previousCode: string;
  newCode: string;
  /** JSX 源码替换范围，用于 noUpdateFileSystem 时同步画布 DOM 的绝对定位数据。 */
  sourceReplacements?: SourceReplacement[];
}

type StyleKeyRoute = {
  selector: string;
  /** Less 预览直接修改该 CSSOM 规则，保持原有 source order。 */
  cssRule?: CSSStyleRule;
  isJsx: boolean;
  loc?: { start: number; end: number };
  needsAI?: boolean;
  source?: 'jsx-inline' | 'less';
  /** selectorText 在当前 shadowRoot 下实际命中的 DOM 数量，用于调试/辅助判断 */
  matchedElementCount?: number;
  /** selectorText 命中的 DOM 去重后的源码 JSX 位置数量；相同代码位置的 map 实例视为 1 个 */
  matchedSourceLocationCount?: number;
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

const stringifyStyleValue = (value: StyleValue) => typeof value === 'number' ? `${value}px` : value

const getJsxStyleValueLength = (value: StyleValue, asString = true) => {
  if (!asString) return String(value).length
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return escaped.length + 2
}

/** Return the exact range for a source transformation that only inserts text. */
const getSingleInsertionReplacement = (previousCode: string, newCode: string): SourceReplacement | null => {
  if (newCode.length <= previousCode.length) return null

  let start = 0
  while (start < previousCode.length && previousCode[start] === newCode[start]) start += 1

  let previousEnd = previousCode.length
  let newEnd = newCode.length
  while (previousEnd > start && newEnd > start && previousCode[previousEnd - 1] === newCode[newEnd - 1]) {
    previousEnd -= 1
    newEnd -= 1
  }

  if (previousEnd !== start) return null
  return { start, end: start, newLength: newEnd - start }
}

const isJsxFile = (fileName: string) => ['jsx', 'tsx'].includes(fileName.split('.').pop() ?? '')

const isFlexLayout = (targetEle: HTMLElement) => {
  const display = window.getComputedStyle(targetEle).display
  return display === 'flex' || display === 'inline-flex'
}

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

const getSourceLocationKey = (targetEle: HTMLElement): string | null => {
  const loc = parseJSON<any>(targetEle.dataset.loc)
  const jsxFile = loc?.files?.jsx
  const jsxStart = loc?.jsx?.start
  const jsxEnd = loc?.jsx?.end

  if (jsxFile && typeof jsxStart === 'number' && typeof jsxEnd === 'number') {
    return `${jsxFile}:${jsxStart}:${jsxEnd}`
  }

  const lineStart = loc?.codeLine?.start
  const lineEnd = loc?.codeLine?.end
  if (jsxFile && typeof lineStart === 'number' && typeof lineEnd === 'number') {
    return `${jsxFile}:L${lineStart}:L${lineEnd}`
  }

  return null
}

const getSelectorMatchStats = (selector: string, shadowRoot: ShadowRoot): SelectorMatchStats => {
  const matchedElements = getSelectorMatchedElements(selector, shadowRoot)
  if (!matchedElements) return {}

  const sourceLocationKeys = new Set<string>()
  matchedElements.forEach((matchedEle, index) => {
    // 没有 data-loc 时退化为 DOM 实例粒度，避免错误地把未知来源的多个节点合并成 1 个。
    sourceLocationKeys.add(getSourceLocationKey(matchedEle) ?? `__dom_${index}`)
  })

  return {
    elementCount: matchedElements.length,
    sourceLocationCount: sourceLocationKeys.size,
  }
}

const isSingleDomLessRoute = (route?: StyleKeyRoute) => {
  return route?.source === 'less' && route.matchedSourceLocationCount === 1
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

const pushLessStyle = (lessStyle: LessStyleMap, selector: string, key: string, value: StyleValue) => {
  const lessValue = { key, value }
  if (!lessStyle.has(selector)) {
    lessStyle.set(selector, [lessValue])
  } else {
    lessStyle.get(selector)!.push(lessValue)
  }
}

const patchLessStyles = (lessStyle: LessStyleMap, fallbackLessFile?: string): FileUpdate[] => {
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
      if (dashIdx === -1) {
        if (fallbackLessFile) {
          return {
            fileName: fallbackLessFile,
            className: clean
          }
        }
        return null
      }
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

    const flatSelector = classPath.join(' ')
    const flatRule = cssObj[flatSelector]
    let target: Record<string, any>

    if (flatRule && typeof flatRule === 'object') {
      // parseLess 会保留平铺选择器，优先更新已有规则，避免错误创建嵌套规则。
      target = flatRule
    } else {
      // 未命中平铺选择器时，按 classPath 创建或进入 Less 嵌套结构。
      target = cssObj
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
      target = target[targetKey]
    }

    value.forEach(({ key: propKey, value: propVal }) => {
      target[propKey] = stringifyStyleValue(propVal)
    })

    // 写入嵌套规则后，清理平铺规则中可能覆盖上述属性的简写冲突。
    if (!flatRule || typeof flatRule !== 'object') {
      clearFlatRuleConflicts(cssObj, classPath, value.map(v => v.key))
    }

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
  nextStyle: Record<string, StyleValue>,
  initialInlineCssText = '',
): {
  fileName: string;
  previousCode: string;
  newCode: string;
  nextStyleInfo: Record<string, StyleKeyInfo> | null;
  sourceReplacements: SourceReplacement[];
} | null => {
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
  const sourceReplacements: SourceReplacement[] = []

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
    // patchJsxInlineStyle applies from right to left. Preserve that order so
    // each source range is interpreted against the corresponding intermediate source.
    sourceReplacements.push(...[...existingEntries]
      .sort((a, b) => b.valueStart - a.valueStart)
      .map(({ val, valueStart, valueEnd }) => ({
        start: valueStart,
        end: valueEnd,
        newLength: getJsxStyleValueLength(val),
      })))
    if (styleInfo) {
      latestStyleInfo = applyStyleInfoOffset(styleInfo, existingEntries.map(({ val, valueStart, valueEnd }) => {
        const escaped = val.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
        return { valueStart, valueEnd, newLen: `'${escaped}'`.length }
      }))
    }
  }

  const hasPropsToAdd = Object.keys(propsToAdd).length > 0
  if (hasPropsToAdd) {
    const codeBeforeAppend = newCode
    if (latestStyleInfo) {
      const appendResult = appendPropsToExistingInlineStyle(newCode, jsxInfo.loc, latestStyleInfo, propsToAdd)
      if (!appendResult) return null
      newCode = appendResult.newSource
      // Merge newly-appended prop offsets into latestStyleInfo so the return value reflects accurate positions.
      latestStyleInfo = { ...latestStyleInfo, ...appendResult.styleInfoUpdates }
    } else {
      // 没有 data-style-info 表示源码标签可能尚无静态 style 属性；若运行时已有 style，通常来自变量 style={x}，不能安全再注入一个 style 属性。
      if (initialInlineCssText) return null
      const tagEnd: number | undefined = jsxInfo.loc?.tag?.end
      if (tagEnd == null) return null
      const injectResult = injectStyleAttrIntoJSX(newCode, tagEnd, propsToAdd)
      if (!injectResult) return null
      newCode = injectResult.newSource
      // injectStyleAttrIntoJSX produced a brand-new style attr; capture the fresh offsets.
      latestStyleInfo = injectResult.styleInfo
    }
    const insertion = getSingleInsertionReplacement(codeBeforeAppend, newCode)
    if (!insertion) return null
    sourceReplacements.push(insertion)
  }

  if (newCode === jsxInfo.previousCode) return null
  return {
    fileName: jsxInfo.fileName,
    previousCode: jsxInfo.previousCode,
    newCode,
    // Return the updated source-offset map so callers can write it back to data-style-info,
    // keeping subsequent edits (noUpdateFileSystem) aligned with the new source positions.
    nextStyleInfo: latestStyleInfo,
    sourceReplacements,
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
  let lessFile = ''
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
  let shouldAddFlexDisplay = false
  let flexDisplaySelector = ''
  let previewStyleSheet: CSSStyleSheet | null = null
  let ruleStyleSnapshots: CssRuleStyleSnapshot[] = []
  let previewInlineSnapshots: InlineStyleSnapshot[] = []
  let temporaryPreviewRules: CSSStyleRule[] = []

  const findStyleRule = (sheet: CSSStyleSheet, selector: string) => {
    return Array.from(sheet.cssRules).find((rule): rule is CSSStyleRule => {
      return rule instanceof CSSStyleRule && rule.selectorText === selector
    })
  }

  const getPreviewRule = (route: StyleKeyRoute) => {
    if (route.cssRule) return route.cssRule
    if (!previewStyleSheet || !route.selector) return null

    const existingRule = findStyleRule(previewStyleSheet, route.selector)
    if (existingRule) {
      route.cssRule = existingRule
      return existingRule
    }

    // Less 编译会省略空规则。预览期间创建一个空规则，完成时由源码更新接管。
    try {
      const index = previewStyleSheet.cssRules.length
      previewStyleSheet.insertRule(`${route.selector} {}`, index)
      const insertedRule = previewStyleSheet.cssRules[index]
      if (insertedRule instanceof CSSStyleRule) {
        route.cssRule = insertedRule
        temporaryPreviewRules.push(insertedRule)
        return insertedRule
      }
    } catch {
      // 无法插入的选择器不影响其它属性预览。
    }
    return null
  }

  const setRulePreviewStyle = (route: StyleKeyRoute, key: string, value: StyleValue) => {
    const rule = getPreviewRule(route)
    if (!rule) return

    const cssProp = convertCamelToHyphen(key)
    let snapshot = ruleStyleSnapshots.find(item => item.rule === rule && item.cssProp === cssProp)
    if (!snapshot) {
      const initialValue = rule.style.getPropertyValue(cssProp)
      snapshot = {
        rule,
        cssProp,
        hadInitialValue: initialValue !== '',
        initialValue,
        initialPriority: rule.style.getPropertyPriority(cssProp),
      }
      ruleStyleSnapshots.push(snapshot)
    }

    // 继承原声明的 !important 语义，不因预览意外改变优先级。
    rule.style.setProperty(cssProp, stringifyStyleValue(value), snapshot.initialPriority)
  }

  const setInlinePreviewStyle = (target: HTMLElement, key: string, value: StyleValue) => {
    const cssProp = convertCamelToHyphen(key)
    let snapshot = previewInlineSnapshots.find(item => item.ele === target && item.cssProp === cssProp)
    if (!snapshot) {
      snapshot = getInitialInlineStyleSnapshot(target, key, stringifyStyleValue(value))
      previewInlineSnapshots.push(snapshot)
    }
    target.style.setProperty(cssProp, stringifyStyleValue(value))
  }

  const clearPreviewStyles = () => {
    ruleStyleSnapshots.forEach((snapshot) => {
      if (snapshot.hadInitialValue) {
        snapshot.rule.style.setProperty(snapshot.cssProp, snapshot.initialValue, snapshot.initialPriority)
      } else {
        snapshot.rule.style.removeProperty(snapshot.cssProp)
      }
    })
    previewInlineSnapshots.forEach(snapshot => {
      if (snapshot.hadInitialValue) {
        snapshot.ele.style.setProperty(snapshot.cssProp, snapshot.initialValue)
      } else {
        snapshot.ele.style.removeProperty(snapshot.cssProp)
      }
    })
    temporaryPreviewRules.forEach((rule) => {
      const sheet = rule.parentStyleSheet
      if (!sheet) return
      const index = Array.from(sheet.cssRules).indexOf(rule)
      if (index >= 0) sheet.deleteRule(index)
    })
    ruleStyleSnapshots = []
    previewInlineSnapshots = []
    temporaryPreviewRules = []
    previewStyleSheet = null
  }

  return function handler(ctx: any, params: any) {
    const { state, multiple } = params
    /**
     * multiple
     *  - true 批量修改样式
     *  - 否则 只修改当前元素样式
     */
    try {
      if (state === 'start') {
        clearPreviewStyles()
        isStart = false
        const sourceEle = getEle(ctx, params)
        ele = resolveTargetEle(sourceEle, style, multiple)
        initialInlineCssText = ele.style?.cssText ?? ''
        initialInlineStyleValues = {}
      } else if (state === 'ing' || state === 'moving') { // [引擎兼容处理] state传参未统一
        style = resolveStyle(
          multiple
            ? getStyle(ctx, params)
            : subtractParentGapFromStyle(getStyle(ctx, params), getEle(ctx, params)),
          multiple,
        )

        if (!isStart) {
          const sourceEle = getEle(ctx, params)
          ele = resolveTargetEle(sourceEle, style, multiple)
          shouldAddFlexDisplay = hasGapStyle(style) && !isFlexLayout(ele)
          // initialInlineCssText = ele.style?.cssText ?? ''
          // initialInlineStyleValues = {}
          Object.keys(style as Record<string, number>).forEach((key) => {
            const initialValue = ele.style.getPropertyValue(convertCamelToHyphen(key))
            initialInlineStyleValues[key] = {
              hadInitialValue: initialValue !== '',
              initialValue,
            }
          })
          if (shouldAddFlexDisplay) {
            const initialValue = ele.style.getPropertyValue('display')
            initialInlineStyleValues.display = {
              hadInitialValue: initialValue !== '',
              initialValue,
            }
          }
          const componentID = context.component!.params.id
          // ele 是 resolveTargetEle 后的目标（gap 场景下为 parent），data-loc 在 ele 上，fallback 到 sourceEle
          const locRaw = ele.dataset?.loc ?? sourceEle.dataset?.loc
          const loc = locRaw ? (() => { try { return JSON.parse(locRaw) } catch { return null } })() : null
          lessFile = resolveLessFilePath(
            loc?.files?.less,
            context.component?.params?.data?.files,
            config.getEntryFile(),
          )
          // styleID 计算规则需与 index.tsx 中 canvas.css.set 保持一致：
          // prototype 模式下：`${componentID}_${path}_${lessFile}`.replace(/[^0-9a-zA-Z]/g, '_')
          // 其他模式下：`${componentID}_${lessFile}`.replace(/\./g, '__').replace(/\//g, '_')
          const frontendMode = config.getFrontendMode()
          let styleID: string
          if (frontendMode === 'prototype') {
            // 从 ele 向上查找最近的带 data-desn-page 属性的祖先，获取当前页面路径
            const pageEle = (sourceEle as HTMLElement | null)?.closest?.('[data-desn-page]') as HTMLElement | null
            const pagePath = pageEle?.dataset?.desnPage ?? null
            if (pagePath != null) {
              styleID = `${componentID}_${pagePath}_${lessFile}`.replace(/[^0-9a-zA-Z]/g, '_')
            } else {
              styleID = `${componentID}_${lessFile}`.replace(/\./g, '__').replace(/\//g, '_')
            }
          } else {
            styleID = `${componentID}_${lessFile}`.replace(/\./g, '__').replace(/\//g, '_')
          }
          const shadowRoot = getShadowRoot()
          const styleTag = shadowRoot.querySelector(`#${styleID}`) as HTMLStyleElement | null
          const sheet = styleTag?.sheet ?? null
          // styleTag 或 sheet 未就绪时跳过本次，等下次 ing 再试
          if (!sheet) return
          previewStyleSheet = sheet
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
          const specificities = new Map<CSSStyleRule, ReturnType<typeof calculate>>()
          const sortableMatchedRules = matchedRules.filter((rule) => {
            try {
              specificities.set(rule, calculate(rule.selectorText))
              return true
            } catch (e) {
              return false
            }
          })
          matchedRules.splice(0, matchedRules.length, ...sortableMatchedRules)
          const sourceOrders = new Map(matchedRules.map((rule, index) => [rule, index]))
          matchedRules.sort((a, b) => {
            // b 在前，a 在后 → 权重高的排到索引 0
            const cmp = compare(specificities.get(b)!, specificities.get(a)!)
            if (cmp !== 0) return cmp
            // specificity 相同时，source order 靠后的优先（index 越大越靠后）
            return sourceOrders.get(b)! - sourceOrders.get(a)!
          })
          let winningRule: CSSStyleRule
          // 插入的普通 className（例如 `uhello`）不一定有对应的 Less 规则。
          // 这类节点不能凭空推断 Less 文件和选择器，应直接写回 JSX style 属性。
          let shouldWriteInlineStyle = false
          if (matchedRules[0]) {
            winningRule = matchedRules[0]
          } else {
            // Less 编译时空规则会被省略，sheet 里找不到该 class 的规则。
            // 回退：从 classList 里找 CSS Module 前缀类（含 '--'），构造合成选择器
            const moduleClass = [...ele.classList].find(c => c.includes('--'))
            if (!moduleClass) {
              shouldWriteInlineStyle = true
              winningRule = { selectorText: '', style: { getPropertyValue: () => '' } } as unknown as CSSStyleRule
            } else {
              const syntheticSelector = `:where(.${componentID}) .${moduleClass}`
              winningRule = { selectorText: syntheticSelector, style: { getPropertyValue: () => '' } } as unknown as CSSStyleRule
            }
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
            if (shouldWriteInlineStyle) {
              styleKeyRoutes[key] = {
                selector: '',
                isJsx: true,
                source: 'jsx-inline',
                initialValue: getElementNumericStyleValue(ele, key),
              }
              return
            }

            const info = styleInfo?.[key]
            const inlineSyncTargets = multiple && lessSelectorFromLoc
              ? collectInlineSyncTargets(lessSelectorFromLoc, key, ele, shadowRoot)
              : []

            if (info) {
              if (info.kind === 'static' && info.valueStart != null && info.valueEnd != null) {
                const initialValue = getElementNumericStyleValue(ele, key)
                const lessInitialValue = lessSelectorFromLoc ? getRuleNumericStyleValue(sheet, lessSelectorFromLoc, key) : undefined
                const selector = lessSelectorFromLoc ?? winningRule.selectorText
                const cssRule = lessSelectorFromLoc ? findStyleRule(sheet, lessSelectorFromLoc) : undefined
                const matchStats = getSelectorMatchStats(selector, shadowRoot)
                // JSX 内联 style：单元素模式继续写当前 JSX；批量模式同时更新当前 JSX inline 与 Less。
                // 这样当前元素保留个性化值，其他同 class 元素通过 Less 按同一 delta 变化。
                styleKeyRoutes[key] = {
                  selector,
                  cssRule,
                  isJsx: !lessSelectorFromLoc,
                  loc: {
                    start: info.valueStart,
                    end: info.valueEnd
                  },
                  source: 'jsx-inline',
                  initialValue,
                  lessInitialValue,
                  matchedElementCount: matchStats.elementCount,
                  matchedSourceLocationCount: matchStats.sourceLocationCount,
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
                const cssRule = ownerCssRule ?? (matchedRules[0] ? winningRule : undefined)
                const matchStats = getSelectorMatchStats(selector, shadowRoot)
                const routeInlineSyncTargets = multiple
                  ? (selector === lessSelectorFromLoc
                    ? inlineSyncTargets
                    : collectInlineSyncTargets(selector, key, ele, shadowRoot))
                  : []
                styleKeyRoutes[key] = {
                  selector,
                  cssRule,
                  isJsx: false,
                  source: 'less',
                  initialValue: getElementNumericStyleValue(ele, key),
                  matchedElementCount: matchStats.elementCount,
                  matchedSourceLocationCount: matchStats.sourceLocationCount,
                  inlineSyncTargets: routeInlineSyncTargets,
                }
              }
            }
          })
          flexDisplaySelector = Object.entries(styleKeyRoutes)
            .find(([key, route]) => GAP_KEYS.has(key) && !route.needsAI && route.selector)?.[1].selector
            ?? winningRule.selectorText

        }

        if (!multiple) {
          const inlineStyleEntries: Array<[string, number]> = []

          Object.entries(style as Record<string, number>).forEach(([key, val]) => {
            const route = styleKeyRoutes[key]
            if (isSingleDomLessRoute(route)) {
              setRulePreviewStyle(route!, key, val)
            } else {
              inlineStyleEntries.push([key, val])
            }
          })

          inlineStyleEntries.forEach(([key, val]) => {
            ele.style.setProperty(convertCamelToHyphen(key), `${val}px`)
          })
          if (shouldAddFlexDisplay) ele.style.setProperty('display', 'flex')
          return
        }

        Object.entries(style as Record<string, number>).forEach(([key, val]) => {
          const route = styleKeyRoutes[key]
          if (!route || route.needsAI) return
          let cssValue = val

          if (route.source === 'jsx-inline' && route.syncInline) {
            const delta = val - (route.initialValue ?? 0)
            cssValue = (route.lessInitialValue ?? 0) + delta
            ;(route.inlineSyncTargets?.length ? route.inlineSyncTargets : [{ ele, initialValue: route.initialValue ?? 0 }]).forEach((target) => {
              setInlinePreviewStyle(target.ele, key, (target.initialValue ?? 0) + delta)
            })
          } else if (route.source === 'less' && route.inlineSyncTargets?.length) {
            const delta = val - (route.initialValue ?? 0)
            route.inlineSyncTargets.forEach((target) => {
              setInlinePreviewStyle(target.ele, key, target.initialValue + delta)
            })
          }

          if (route.source === 'jsx-inline' && !route.syncInline) {
            if (!route.selector) {
              setInlinePreviewStyle(ele, key, cssValue)
              return
            }
            getSelectorMatchedElements(route.selector, getShadowRoot())?.forEach((target) => {
              setInlinePreviewStyle(target, key, cssValue)
            })
            return
          }

          setRulePreviewStyle(route, key, cssValue)
        })
        if (shouldAddFlexDisplay && flexDisplaySelector) {
          const flexRoute = Object.values(styleKeyRoutes).find(route => route.selector === flexDisplaySelector)
          setRulePreviewStyle(flexRoute ?? {
            selector: flexDisplaySelector,
            isJsx: false,
            source: 'less',
          }, 'display', 'flex')
        }
      } else if (state === 'finish') {
        isStart = false
        const rawFinishStyle = getStyle(ctx, params) || style
        style = resolveStyle(
          multiple
            ? rawFinishStyle
            : subtractParentGapFromStyle(rawFinishStyle, ele),
          multiple,
        )
        // 拖拽预览只改 CSSOM；源码写回前先还原，最终样式由重新编译的 Less 接管。
        clearPreviewStyles()
        const aiKeys = Object.entries(styleKeyRoutes)
          .filter(([, route]) => route.needsAI)
          .map(([key]) => ({ key, value: (style as Record<string, number>)[key] }))

        if (!multiple) {
          const lessStyle: LessStyleMap = new Map()
          const inlineStyle: Record<string, StyleValue> = {}

          Object.entries(style as Record<string, number>).forEach(([key, value]) => {
            const route = styleKeyRoutes[key]
            if (isSingleDomLessRoute(route)) {
              pushLessStyle(lessStyle, route!.selector, key, value)
            } else if (!route?.needsAI) {
              inlineStyle[key] = value
            }
          })
          if (shouldAddFlexDisplay) inlineStyle.display = 'flex'

          // Snapshot the current data-style-info BEFORE patching so undo can restore it.
          const prevStyleInfoStr = ele.dataset.styleInfo

          const inlineUpdate = Object.keys(inlineStyle).length
            ? patchSingleElementInlineStyle(ele, inlineStyle, initialInlineCssText)
            : null
          const lessUpdates = patchLessStyles(lessStyle, lessFile)
          const inlineUpdateAsFileUpdate: FileUpdate | null = inlineUpdate
            ? {
              fileName: inlineUpdate.fileName,
              previousCode: inlineUpdate.previousCode,
              newCode: inlineUpdate.newCode,
              sourceReplacements: inlineUpdate.sourceReplacements,
            }
            : null
          const updateFIles: FileUpdate[] = (inlineUpdateAsFileUpdate ? [inlineUpdateAsFileUpdate] : [] as FileUpdate[]).concat(lessUpdates)
          const inlineStyleSnapshots = inlineUpdate
            ? Object.entries(inlineStyle).map(([key, value]) => getInitialInlineStyleSnapshot(ele, key, stringifyStyleValue(value), initialInlineStyleValues[key]))
            : []
          // Pre-serialise the updated offset map so execute/undo closures don't hold a reference
          // to a mutable object.
          const nextStyleInfoStr = inlineUpdate?.nextStyleInfo
            ? JSON.stringify(inlineUpdate.nextStyleInfo)
            : null
          const shadowRoot = getShadowRoot()
          const sourceLocationSnapshots = new Map<string, ReturnType<typeof createDOMSourceLocationSnapshot>>()
          updateFIles.forEach(({ fileName, sourceReplacements }) => {
            if (isJsxFile(fileName) && sourceReplacements?.length && !sourceLocationSnapshots.has(fileName)) {
              sourceLocationSnapshots.set(fileName, createDOMSourceLocationSnapshot(shadowRoot, fileName))
            }
          })

          if (updateFIles.length) {
            const actionId = randomUUID()
            const title = getStyleActionTitle(ele)
            undoRedoManager.executeBranch({
              execute() {
                updateFIles.forEach(({ fileName, newCode }) => {
                  const suffix = fileName.split('.').pop()!;
                  context.updateFile({ fileName, content: newCode, type: undefined, noUpdateFileSystem: ['jsx', 'tsx'].includes(suffix) });
                })
                updateFIles.forEach(({ fileName, sourceReplacements }) => {
                  if (!isJsxFile(fileName)) return
                  sourceReplacements?.forEach((replacement) => {
                    shiftDOMSourceLocationsAfterReplacement(shadowRoot, fileName, replacement)
                  })
                })
                applyInlineStyleSnapshots(inlineStyleSnapshots, 'execute')
                // Keep data-style-info in sync with the (noUpdateFileSystem) source-file offsets
                // so that subsequent inline-style drags can locate values correctly.
                if (nextStyleInfoStr) ele.dataset.styleInfo = nextStyleInfoStr
                context.component!.actions.addUserAction({
                  id: actionId,
                  type: 'update-style',
                  title,
                  refElement: ele,
                })
              },
              undo() {
                updateFIles.forEach(({ fileName, previousCode }) => {
                  const suffix = fileName.split('.').pop()!;
                  context.updateFile({ fileName, content: previousCode, type: undefined, noUpdateFileSystem: ['jsx', 'tsx'].includes(suffix) });
                })
                sourceLocationSnapshots.forEach((snapshot) => restoreDOMSourceLocationSnapshot(snapshot))
                applyInlineStyleSnapshots(inlineStyleSnapshots, 'undo')
                // Restore the pre-edit offset map so a redo / re-drag operates on correct offsets.
                if (nextStyleInfoStr) ele.dataset.styleInfo = prevStyleInfoStr ?? ''
                context.component!.actions.removeUserAction(actionId)
              },
            });
          }
          if (aiKeys.length) {
            const label = getElementLabel(ele, '节点1')
            const title = getStyleActionTitle(ele)
            const actionId = randomUUID()
            const chip = {
              id: randomUUID(),
              type: 'element-style-update',
              label: `调整 ${label} 样式`,
              data: buildElementStyleUpdateChipData(ele, aiKeys, label),
            }
            const inlineStyleSnapshots = aiKeys.map(({ key, value }) => getInitialInlineStyleSnapshot(
              ele,
              key,
              stringifyStyleValue(value),
              initialInlineStyleValues[key],
            ))

            undoRedoManager.executeBranch({
              aiRequest: {
                message: `[[chip:${chip.id}]]`,
                chips: [chip],
              },
              execute() {
                applyInlineStyleSnapshots(inlineStyleSnapshots, 'execute')
                context.component!.actions.addUserAction({
                  id: actionId,
                  type: 'update-style',
                  title,
                  refElement: ele,
                })
              },
              undo() {
                applyInlineStyleSnapshots(inlineStyleSnapshots, 'undo')
                context.component!.actions.removeUserAction(actionId)
              },
            })
          }
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
        const fallbackInlineStyle: Record<string, StyleValue> = {}

        Object.entries(styleKeyRoutes).forEach(([key, route]) => {
          const { isJsx, selector, loc, needsAI } = route
          if (needsAI) return  // 交给 AI，不写入 JSX/Less
          const value = style[key]
          if (route.source === 'jsx-inline' && !selector) {
            fallbackInlineStyle[key] = value
          } else if (route.source === 'jsx-inline' && route.syncInline) {
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
        if (shouldAddFlexDisplay && flexDisplaySelector) {
          pushLessStyle(lessStyle, flexDisplaySelector, 'display', 'flex')
        }
        if (shouldAddFlexDisplay && Object.keys(fallbackInlineStyle).length) {
          fallbackInlineStyle.display = 'flex'
        }

        const jsxs: FileUpdate[] = []

        const pushJsxUpdate = (update: FileUpdate) => {
          const existing = jsxs.find(item => item.fileName === update.fileName)
          if (existing) {
            existing.newCode = update.newCode
            existing.sourceReplacements = update.sourceReplacements
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
              newCode: jsxNewCode,
              // patchJsxInlineStyle applies from right to left, so preserve its
              // replacement order when rebasing DOM source locations.
              sourceReplacements: [...entries]
                .sort((a, b) => b.loc.start - a.loc.start)
                .map((entry) => ({
                  start: entry.loc.start,
                  end: entry.loc.end,
                  newLength: getJsxStyleValueLength(
                    entry.asString ? stringifyStyleValue(entry.value) : entry.value,
                    entry.asString,
                  ),
                })),
            })
          })
        }

        // 没有可匹配的 CSS class 时，直接把样式写进当前 JSX 节点。
        // patchSingleElementInlineStyle 同时支持更新已有静态 style 和注入新的 style 属性。
        const prevFallbackStyleInfoStr = ele.dataset.styleInfo
        const fallbackInlineUpdate = Object.keys(fallbackInlineStyle).length
          ? patchSingleElementInlineStyle(ele, fallbackInlineStyle, initialInlineCssText)
          : null
        if (fallbackInlineUpdate) {
          pushJsxUpdate(fallbackInlineUpdate)
        }

        const lesss = patchLessStyles(lessStyle, lessFile)
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
          .concat(Object.entries(fallbackInlineStyle).map(([key, value]) => (
            getInitialInlineStyleSnapshot(ele, key, stringifyStyleValue(value), initialInlineStyleValues[key])
          )))
        const updateFIles = jsxs.concat(lesss)
        const nextFallbackStyleInfoStr = fallbackInlineUpdate?.nextStyleInfo
          ? JSON.stringify(fallbackInlineUpdate.nextStyleInfo)
          : null
        const shadowRoot = getShadowRoot()
        const sourceLocationSnapshots = new Map<string, ReturnType<typeof createDOMSourceLocationSnapshot>>()
        updateFIles.forEach(({ fileName, sourceReplacements }) => {
          if (isJsxFile(fileName) && sourceReplacements?.length && !sourceLocationSnapshots.has(fileName)) {
            sourceLocationSnapshots.set(fileName, createDOMSourceLocationSnapshot(shadowRoot, fileName))
          }
        })

        if (updateFIles.length) {
          const actionId = randomUUID()
          const title = getStyleActionTitle(ele)
          undoRedoManager.executeBranch({
            execute() {
              updateFIles.forEach(({ fileName, newCode }) => {
                const suffix = fileName.split('.').pop()!;
                context.updateFile({ fileName, content: newCode, type: undefined, noUpdateFileSystem: ['jsx', 'tsx'].includes(suffix) });
              })
              updateFIles.forEach(({ fileName, sourceReplacements }) => {
                if (!isJsxFile(fileName)) return
                sourceReplacements?.forEach((replacement) => {
                  shiftDOMSourceLocationsAfterReplacement(shadowRoot, fileName, replacement)
                })
              })
              applyInlineStyleSnapshots(jsxInlineStyleSnapshots, 'execute')
              if (nextFallbackStyleInfoStr) ele.dataset.styleInfo = nextFallbackStyleInfoStr
              context.component!.actions.addUserAction({
                id: actionId,
                type: 'update-style',
                title,
                refElement: ele,
              })
            },
            undo() {
              updateFIles.forEach(({ fileName, previousCode }) => {
                const suffix = fileName.split('.').pop()!;
                context.updateFile({ fileName, content: previousCode, type: undefined, noUpdateFileSystem: ['jsx', 'tsx'].includes(suffix) });
              })
              sourceLocationSnapshots.forEach((snapshot) => restoreDOMSourceLocationSnapshot(snapshot))
              applyInlineStyleSnapshots(jsxInlineStyleSnapshots, 'undo')
              if (nextFallbackStyleInfoStr) ele.dataset.styleInfo = prevFallbackStyleInfoStr ?? ''
              context.component!.actions.removeUserAction(actionId)
            },
          });
        }

        if (aiKeys.length > 0) {
          const label = getElementLabel(ele, '节点1')
          const title = getStyleActionTitle(ele)
          const actionId = randomUUID()
          const chip = {
            id: randomUUID(),
            type: 'element-style-update',
            label: `调整 ${label} 样式`,
            data: buildElementStyleUpdateChipData(ele, aiKeys, label),
          }
          const inlineStyleSnapshots = aiKeys.map(({ key, value }) => getInitialInlineStyleSnapshot(
            ele,
            key,
            stringifyStyleValue(value),
            initialInlineStyleValues[key],
          ))

          undoRedoManager.executeBranch({
            aiRequest: {
              message: `[[chip:${chip.id}]]`,
              chips: [chip],
            },
            execute() {
              // AI 修改尚未写回源码，仅更新画布预览；不要修改 data-style-info 等源码定位数据。
              applyInlineStyleSnapshots(inlineStyleSnapshots, 'execute')
              context.component!.actions.addUserAction({
                id: actionId,
                type: 'update-style',
                title,
                refElement: ele,
              })
            },
            undo() {
              applyInlineStyleSnapshots(inlineStyleSnapshots, 'undo')
              context.component!.actions.removeUserAction(actionId)
            },
          })
        }
      }
    } catch (e) {
      clearPreviewStyles()
      console.error(e)
    }
  }
}
