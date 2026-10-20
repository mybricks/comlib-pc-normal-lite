import type { LayoutElement } from './layoutTypes'
import { calculate, compare } from 'specificity'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function classMatchesShortName(cls: string, shortName: string): boolean {
  return cls === shortName ||
    cls.endsWith('--' + shortName) ||
    (cls.endsWith('-' + shortName) && cls.slice(0, cls.length - shortName.length - 1).includes('_'))
}


function stripComIdScope(part: string, comId: string): string {
  let s = part.trim()
  const head = s.match(/^:(where|is)\(/i)
  if (head) {
    const innerStart = head[0].length
    let depth = 1
    let i = innerStart
    for (; i < s.length; i++) {
      const ch = s[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) break
      }
    }
    if (depth === 0) {
      const inner = s.slice(innerStart, i).trim()
      // 作用域主体以 .comId 开头（后面可跟空格、属性、伪类等）
      const scopedByComId = new RegExp(
        `^\\.${escapeRegExp(comId)}(?:$|[\\s:.[#])`
      ).test(inner)
      if (scopedByComId) {
        s = s.slice(i + 1).trim()
      }
    }
  }
  const bareRe = new RegExp(`^\\.${escapeRegExp(comId)}\\s+`)
  s = s.replace(bareRe, '')
  return s.trim()
}


export function isZoneTabNoiseClass(name: string): boolean {
  if (!name) return true
  // 默认排除平台实例 id、antd / emotion 运行时 class。
  // 当前节点自身的 ant-* 可由组件 CSSOM 命中规则确认为可编辑主体。
  if (/^u_[A-Za-z0-9]+$/.test(name)) return true
  if (name.startsWith('ant-')) return true
  if (name.startsWith('css-')) return true
  return false
}

/**
 * CSS Module 运行时名 → 短名（不依赖 Babel 打标）。
 * 前缀须含 `_`（编码后的文件路径），避免把手写的 `block--modifier` / `.aiChat-inputArea` 截断。
 */
function heuristicShortName(runtimeClass: string): string {
  // `--` 优先：pages_Foo__module__less--foo-bar 的源码类名是 foo-bar 而非 bar
  const ddIdx = runtimeClass.lastIndexOf('--')
  if (ddIdx > 0 && runtimeClass.slice(0, ddIdx).includes('_')) {
    return runtimeClass.slice(ddIdx + 2)
  }
  const dashIdx = runtimeClass.lastIndexOf('-')
  if (dashIdx > 0 && runtimeClass.slice(0, dashIdx).includes('_')) {
    return runtimeClass.slice(dashIdx + 1)
  }
  return runtimeClass
}

/** 从元素及祖先的 classList 收集短 class 名，用于 CSS Module 还原 */
export function collectKnownShortNames(el: Element): Set<string> {
  const names = new Set<string>()
  let cur: Element | null = el
  while (cur) {
    for (const name of (cur.getAttribute('data-zone-classnames') || '').split(/[\s,]+/).filter(Boolean)) names.add(name)
    for (const runtime of Array.from(cur.classList || [])) {
      if (isZoneTabNoiseClass(runtime)) continue
      // 只收短名：把运行时哈希名也放进来会让 demangleClassName 自匹配，还原不掉哈希
      names.add(heuristicShortName(runtime))
    }
    cur = cur.parentElement
  }
  return names
}


function demangleClassName(runtimeClass: string, knownShortNames: Set<string>): string {
  for (const sn of knownShortNames) {
    // 短名集合可能仍含运行时名自身（如 rich-input_u9Ux8 这类还原不掉的形态），
    // 自匹配会让哈希名原样返回，最终写进 Less 变成永远匹配不到元素的脏规则
    if (sn === runtimeClass) continue
    if (classMatchesShortName(runtimeClass, sn)) return sn
    // css-loader 常见 shortName_hash（如 rich-input_u9Ux8 → rich-input）
    if (
      runtimeClass.startsWith(sn + '_') &&
      /^_*[a-zA-Z0-9]+$/.test(runtimeClass.slice(sn.length + 1))
    ) {
      return sn
    }
  }
  // pages_Foo_less-shortName / foo--bar（前缀须含 _，避免 .aiChat-inputArea → inputArea）
  return heuristicShortName(runtimeClass)
}

function demangleSelector(runtimeSel: string, knownShortNames: Set<string>): string {
  return runtimeSel.replace(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g, (_, name: string) => {
    return '.' + demangleClassName(name, knownShortNames)
  })
}

/**
 * 将组件 CSSOM 中的单个选择器分支还原成可用于 Less 写回的源码选择器。
 * 与 Zone Tab 不同，这里保留完整祖先路径，避免 `.hero .title` 被折叠成
 * `.title` 后写到同名顶层规则。
 */
export function resolveCssomSourceSelector(
  selectorPart: string,
  el: Element,
  comId: string
): string {
  const withoutScope = stripComIdScope(selectorPart, comId)
  if (!withoutScope) return ''
  return demangleSelector(
    withoutScope,
    collectKnownShortNames(el)
  ).trim()
}


function splitTopLevelSelectors(selector: string): string[] {
  const result: string[] = []
  let start = 0, depth = 0, quote = ''
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (ch === '\\') { i++; continue }
    if (quote) { if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) { result.push(selector.slice(start, i).trim()); start = i + 1 }
  }
  result.push(selector.slice(start).trim())
  return result.filter(Boolean)
}

const MATCH_ONLY_PSEUDO_CLASSES = new Set([
  'not', 'is', 'where',
  'host', 'host-context', 'slotted', 'scope',
  'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type',
  'first-child', 'last-child', 'only-child',
  'first-of-type', 'last-of-type', 'only-of-type', 'empty',
])

/**
 * 这些伪类既要参与目标元素匹配，也要作为可编辑状态展示。
 * :has(...) 的关系条件不能从 matchSelector 中移除，否则会把不满足
 * :has(...) 的元素也误认为命中了这条状态规则。
 */
const DUAL_ROLE_PSEUDO_CLASSES = new Set(['has'])

const LEGACY_PSEUDO_ELEMENTS = new Set([
  'before', 'after', 'first-line', 'first-letter',
])

/** 只在括号、属性和引号之外分段，避免 :not(...) / :where(...) 内的空格变成祖先路径。 */
export function selectorSubjectStart(selector: string): number {
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (ch === '\\') { i++; continue }
    if (quote) { if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1
  }
  return start
}

function balancedEnd(text: string, start: number): number {
  const close = text[start] === '(' ? ')' : ']'
  let depth = 1
  let quote = ''
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') { i++; continue }
    if (quote) { if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === text[start]) depth++
    else if (ch === close && --depth === 0) return i + 1
  }
  return text.length
}

/**
 * 拆出当前主体的伪类状态；匹配条件仍保留给 matches 校验。
 * :has(...) 同时写入 pseudo 和 matchSelector，因此既能生成 Tab，
 * 又不会丢失它本身的关系匹配条件。
 */
export function splitZoneSelectorState(selector: string) {
  const start = selectorSubjectStart(selector)
  const subject = selector.slice(start)
  let matchSubject = ''
  let pseudo = ''
  for (let i = 0; i < subject.length;) {
    if (subject[i] === '[') {
      const end = balancedEnd(subject, i)
      matchSubject += subject.slice(i, end); i = end; continue
    }
    const token = subject.slice(i).match(/^(:{1,2})([\w-]+)/)
    if (!token) { matchSubject += subject[i++]; continue }
    let end = i + token[0].length
    if (subject[end] === '(') end = balancedEnd(subject, end)
    const name = token[2].toLowerCase()
    const isElement = token[1] === '::' || LEGACY_PSEUDO_ELEMENTS.has(name)
    const isMatchOnlyPseudoClass = token[1] === ':' && MATCH_ONLY_PSEUDO_CLASSES.has(name)
    const isDualRolePseudoClass = token[1] === ':' && DUAL_ROLE_PSEUDO_CLASSES.has(name)
    const tokenText = isElement
      ? '::' + subject.slice(i + token[1].length, end)
      : subject.slice(i, end)

    if (isElement || !isMatchOnlyPseudoClass || isDualRolePseudoClass) {
      pseudo += tokenText
    }
    if (!isElement && (isMatchOnlyPseudoClass || isDualRolePseudoClass)) {
      matchSubject += subject.slice(i, end)
    }
    i = end
  }
  return {
    pseudo: pseudo || null,
    matchSelector: selector.slice(0, start) + (matchSubject || '*'),
    subject: matchSubject,
  }
}

/** 主体的正向 class，不把祖先、:not(.selected)、:has(.child) 当作自身 class。 */
export function subjectClassNames(subject: string, el: Element): string[] {
  const result = new Set<string>()
  for (let i = 0; i < subject.length;) {
    if (subject[i] === '[') { i = balancedEnd(subject, i); continue }
    const fn = subject.slice(i).match(/^:([\w-]+)\(/)
    if (fn) {
      const open = i + fn[0].length - 1
      const end = balancedEnd(subject, open)
      if (fn[1] === 'is' || fn[1] === 'where') {
        for (const part of splitTopLevelSelectors(subject.slice(open + 1, end - 1))) {
          try {
            if (el.matches(part)) {
              subjectClassNames(part.slice(selectorSubjectStart(part)), el).forEach(c => result.add(c))
            }
          } catch {}
        }
      }
      i = end; continue
    }
    const cls = subject.slice(i).match(/^\.([a-zA-Z_][a-zA-Z0-9_-]*)/)
    if (cls) { result.add(cls[1]); i += cls[0].length } else { i++ }
  }
  return Array.from(result)
}


interface LayoutSource {
  /** 浏览器样式表里的选择器，可能带组件作用域和 CSS Modules 名称，用于匹配 DOM。 */
  selectorPart: string
  /** 还原后用于查找 Less 规则的选择器；例如把组件作用域下的运行时类名还原成 .card。 */
  sourceSelector: string
  /** 样式表扫描顺序；选择器优先级相同时，后出现的声明优先。 */
  sourceOrder: number
  style: CSSStyleDeclaration
  specificity: ReturnType<typeof calculate>
}

/**
 * 从浏览器样式表中找出“这个节点的可写样式来自哪些规则”，供布局转换决定写回位置。
 * 只收集当前生效条件下、匹配节点自身 class 的常规态页面规则，不把 :hover 等状态规则混入。
 *
 * 返回的 get('position') 包含所有声明 position 的候选规则和优先级最高的 winner：
 * 修改值时写 winner，删除值时处理全部 candidates，避免删掉一条后另一条又生效。
 * defaultSource 用于新增属性：例如原本没有 left，就用优先级最高的可写规则；
 * 连匹配规则都没有时，尝试使用节点自身的业务 class，后续仍会检查它能否唯一匹配节点。
 */
export function inspectLayoutTarget(target: LayoutElement, componentId: string) {
  const root = target.getRootNode() as Document | ShadowRoot
  const view = target.ownerDocument.defaultView!
  const sheets = new Set<CSSStyleSheet>()
  root.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
    const sheet = (node as HTMLStyleElement).sheet
    if (sheet) sheets.add(sheet)
  })
  Array.from(root.adoptedStyleSheets || []).forEach(sheet => sheets.add(sheet))
  const sources: LayoutSource[] = []
  const matchedDeclarations: CSSStyleDeclaration[] = []
  let order = 0
  const visit = (rules: CSSRuleList) => {
    for (const entry of Array.from(rules)) {
      const rule = entry as CSSStyleRule
      if (rule.selectorText) {
        const sourceOrder = order++
        for (const part of splitTopLevelSelectors(rule.selectorText)) {
          const state = splitZoneSelectorState(part)
          // 自由布局只操作常规态，不把鼠标悬停时的临时定位写回基础布局。
          if (state.pseudo) continue
          try {
            if (!target.matches(part)) continue
            matchedDeclarations.push(rule.style)
            if (!subjectClassNames(state.subject, target).some(name => target.classList.contains(name))) continue
            const sourceSelector = resolveCssomSourceSelector(part, target, componentId)
            // 普通第三方规则即使命中节点，也不能直接当成页面 Less 的源码规则。
            // 这里接受能还原组件作用域/类名的规则，或明确带 data-desn-page 的页面规则。
            if (sourceSelector === part && !/\[\s*data-desn-page\s*=/.test(part)) continue
            sources.push({ selectorPart: part, sourceSelector, sourceOrder, style: rule.style, specificity: calculate(part) })
          } catch { /* 无效或不支持的选择器不参与规划。 */ }
        }
      } else if (entry.type === CSSRule.MEDIA_RULE) {
        const media = entry as CSSMediaRule
        if (view.matchMedia(media.conditionText).matches) visit(media.cssRules)
      } else if (entry.type === CSSRule.SUPPORTS_RULE) {
        const supports = entry as CSSSupportsRule
        if (view.CSS.supports(supports.conditionText)) visit(supports.cssRules)
      }
    }
  }
  for (const sheet of sheets) {
    try {
      if (!sheet.disabled && (!sheet.media?.mediaText || view.matchMedia(sheet.media.mediaText).matches)) visit(sheet.cssRules)
    } catch { /* 跨域样式表不可读取。 */ }
  }
  // 新属性尚无声明可比，默认按 selector 优先级和出现顺序选目标。
  // 已有属性则在下面的 get 中额外比较该属性自己的 !important。
  const rank = (a: LayoutSource, b: LayoutSource) => compare(b.specificity, a.specificity) || b.sourceOrder - a.sourceOrder
  sources.sort(rank)
  const fallbackClass = Array.from(target.classList).find(name => !isZoneTabNoiseClass(name))
  const fallback = fallbackClass && {
    selectorPart: '.' + fallbackClass,
    sourceSelector: resolveCssomSourceSelector('.' + fallbackClass, target, componentId),
  }
  const get = (key: string) => {
    const property = key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())
    const candidates = sources.filter(source => source.style.getPropertyValue(property) !== '').map(source => ({
      source,
      label: source.sourceSelector,
      value: source.style.getPropertyValue(property),
      important: source.style.getPropertyPriority(property) === 'important',
    })).sort((a, b) => Number(b.important) - Number(a.important) || rank(a.source, b.source))
    return { candidates, winner: candidates[0] }
  }
  const ownValue = (key: string): string | undefined => {
    const property = key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())
    const inline = target.style.getPropertyValue(property)
    const winner = get(key).winner
    return winner?.important && target.style.getPropertyPriority(property) !== 'important'
      ? winner.value : inline || winner?.value
  }
  const hasImportantDeclaration = (key: string) => {
    const property = key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())
    return matchedDeclarations.some(style => style.getPropertyPriority(property) === 'important' ||
      (!key.startsWith('--') && style.getPropertyPriority('all') === 'important'))
  }
  // 空规则可能未输出到 CSSOM，仍允许使用自身 class；文件归属和共享匹配由后续校验。
  return { get, ownValue, hasImportantDeclaration, defaultSource: sources[0] || fallback || undefined }
}
