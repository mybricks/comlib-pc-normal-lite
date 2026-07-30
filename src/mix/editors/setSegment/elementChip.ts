const DOM_SUMMARY_SINGLE_TEXT_MAX = 20
const DOM_SUMMARY_TOTAL_MAX = 300
const DOM_SUMMARY_MAX_CHILDREN = 8
const REPEAT_CONTEXT_MAX_DEPTH = 10
const REPEAT_CONTEXT_MAX_SIBLINGS = 200
const DOM_SUMMARY_CLASS_MAX = 3

const DOM_SUMMARY_SKIP_CHILDREN_TAGS = new Set(['svg'])
const DOM_SUMMARY_SKIP_TAGS = new Set([
  'defs',
  'desc',
  'filter',
  'foreignobject',
  'g',
  'lineargradient',
  'marker',
  'mask',
  'metadata',
  'pattern',
  'radialgradient',
  'script',
  'style',
  'symbol',
  'template',
  'title',
  'use',
])
const DOM_SUMMARY_SKIP_SVG_DRAWING_TAGS = new Set([
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
  'stop',
])
const DOM_SUMMARY_NON_PAGE_CODE_ATTRS = ['data-mybricks-tip']

const PLACEMENT_LABEL: Record<string, string> = {
  before: '前面（上方）',
  after: '后面（下方）',
}

interface DomLoc {
  codeLine?: { start?: number; end?: number }
  files?: { jsx?: string; less?: string }
  cn?: string[]
}

interface RepeatSignature {
  key: string
  reason: string
}

interface RepeatAncestorContext {
  node: Element
  index?: number
  total: number
  signature?: RepeatSignature
  skipped?: boolean
}

export interface ParsedElementInfo {
  name: string
  codeLocation: string
  domSummary: string
  currentText?: string
  repeatContextBlock: string
  hasRepeatContext: boolean
}

export interface ParsedElementChipData {
  inlineText: string
  detailText: string
}

export interface ParsedElementDeleteChipData extends ParsedElementChipData {
  target: ParsedElementInfo
}

export interface ParsedElementTextUpdateChipData extends ParsedElementChipData {
  target: ParsedElementInfo
  content: string
}

export interface ParsedElementMoveChipData extends ParsedElementChipData {
  from: ParsedElementInfo
  to: ParsedElementInfo
  placement: 'before' | 'after'
  direction: string
}

function safeParseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch (_) {
    return undefined
  }
}

function getOwnDomLoc<T extends DomLoc>(el: Element): T | undefined {
  return safeParseJson<T>(el.getAttribute('data-loc'))
}

function getClosestDomLoc<T extends DomLoc>(el: Element): T | undefined {
  let current: Element | null = el
  while (current) {
    const loc = safeParseJson<T>(current.getAttribute('data-loc'))
    if (loc) return loc
    current = current.parentElement
  }
  return undefined
}

function shouldSkipDomSummaryChildren(node: Element): boolean {
  return DOM_SUMMARY_SKIP_CHILDREN_TAGS.has(node.tagName.toLowerCase())
}

function shouldSkipDomSummaryNode(node: Element): boolean {
  const tag = node.tagName.toLowerCase()
  return (
    DOM_SUMMARY_NON_PAGE_CODE_ATTRS.some((attr) => node.hasAttribute(attr)) ||
    DOM_SUMMARY_SKIP_TAGS.has(tag) ||
    (node.namespaceURI === 'http://www.w3.org/2000/svg' && DOM_SUMMARY_SKIP_SVG_DRAWING_TAGS.has(tag))
  )
}

function splitClassNames(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getDomSummaryClassNames(node: Element): string {
  const selectorClassNames = safeParseJson<string[]>(node.getAttribute('data-zone-selector'))
  if (Array.isArray(selectorClassNames) && selectorClassNames.length) {
    return selectorClassNames.filter(Boolean).slice(0, DOM_SUMMARY_CLASS_MAX).join(' ')
  }

  const zoneClassNames = node.getAttribute('data-zone-classnames')
  if (zoneClassNames?.trim()) {
    return splitClassNames(zoneClassNames).slice(0, DOM_SUMMARY_CLASS_MAX).join(' ')
  }

  const loc = getOwnDomLoc<DomLoc>(node)
  if (loc?.cn?.length) {
    return loc.cn.filter(Boolean).slice(0, DOM_SUMMARY_CLASS_MAX).join(' ')
  }

  return ''
}

export function indentText(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n')
}

export function extractDomSummary(el: Element, options?: { singleTextMax?: number; totalMax?: number }): string {
  if (shouldSkipDomSummaryNode(el)) return '无页面代码摘要'

  const singleTextMax = options?.singleTextMax ?? DOM_SUMMARY_SINGLE_TEXT_MAX
  const totalMax = options?.totalMax ?? DOM_SUMMARY_TOTAL_MAX
  const lines: string[] = []

  function walk(node: Element, indent: number) {
    if (shouldSkipDomSummaryNode(node)) return

    const tag = node.tagName.toLowerCase()
    const text = Array.from(node.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, singleTextMax)
    const cls = getDomSummaryClassNames(node)
    const comName = node.getAttribute('data-com-name') || ''
    const parts: string[] = [tag]
    if (cls) parts.push(` class: ${cls}`)
    if (comName) parts.push(` 组件: ${comName}`)
    if (text) parts.push(`文本: "${text}"`)
    lines.push('  '.repeat(indent) + parts.join(''))

    if (indent < 3 && !shouldSkipDomSummaryChildren(node)) {
      const visibleChildren = Array.from(node.children).filter((child) => !shouldSkipDomSummaryNode(child))
      visibleChildren.slice(0, DOM_SUMMARY_MAX_CHILDREN).forEach((child) => walk(child, indent + 1))
      if (visibleChildren.length > DOM_SUMMARY_MAX_CHILDREN) {
        lines.push('  '.repeat(indent + 1) + `... ${visibleChildren.length - DOM_SUMMARY_MAX_CHILDREN} more children`)
      }
    }
  }

  walk(el, 0)
  let result = lines.join('\n')
  if (result.length <= totalMax) return result
  const half = Math.floor((totalMax - 30) / 2)
  result = result.slice(0, half) + '\n... [中间内容已省略] ...\n' + result.slice(result.length - half)
  return result
}

export function getElementCodeLocation(el?: Element): string {
  if (!el) return '未知'

  const loc = getClosestDomLoc<DomLoc>(el)
  if (!loc) return '未知'

  const jsxFile = loc.files?.jsx
  const startLine = loc.codeLine?.start
  const endLine = loc.codeLine?.end

  if (!jsxFile && !startLine) return '未知'

  const lineDesc =
    startLine && endLine && endLine !== startLine
      ? `L${startLine}-L${endLine}`
      : startLine
      ? `L${startLine}`
      : '未知行'

  return jsxFile ? `${jsxFile} ${lineDesc}` : lineDesc
}

function formatCodeLoc(loc: DomLoc): string | null {
  const jsxFile = loc.files?.jsx
  const startLine = loc.codeLine?.start
  const endLine = loc.codeLine?.end
  if (!jsxFile || !startLine) return null
  if (endLine && endLine !== startLine) return `${jsxFile}:L${startLine}-L${endLine}`
  return `${jsxFile}:L${startLine}`
}

function normalizeZoneSelectorValue(value: string | null): string {
  if (!value) return ''
  const parsed = safeParseJson<string[]>(value)
  if (Array.isArray(parsed)) return parsed.filter(Boolean).join(' ')
  return value.trim()
}

function getRepeatSignature(el: Element, cache: WeakMap<Element, RepeatSignature | null>): RepeatSignature | null {
  if (cache.has(el)) return cache.get(el) ?? null

  const loc = getOwnDomLoc<DomLoc>(el)
  const locText = loc ? formatCodeLoc(loc) : null
  if (locText) {
    const signature = {
      key: `loc:${locText}`,
      reason: `兄弟节点拥有相同 JSX 位置 ${locText}`,
    }
    cache.set(el, signature)
    return signature
  }

  const comName = el.getAttribute('data-com-name')?.trim() ?? ''
  const zoneSelector = normalizeZoneSelectorValue(el.getAttribute('data-zone-selector'))

  if (comName && zoneSelector) {
    const signature = {
      key: `com+selector:${comName}:${zoneSelector}`,
      reason: `兄弟节点拥有相同组件名「${comName}」和选择器「${zoneSelector}」`,
    }
    cache.set(el, signature)
    return signature
  }

  if (zoneSelector) {
    const signature = {
      key: `selector:${zoneSelector}`,
      reason: `兄弟节点拥有相同选择器「${zoneSelector}」`,
    }
    cache.set(el, signature)
    return signature
  }

  if (comName) {
    const signature = {
      key: `com:${comName}`,
      reason: `兄弟节点拥有相同组件名「${comName}」`,
    }
    cache.set(el, signature)
    return signature
  }

  cache.set(el, null)
  return null
}

function findNearestSignatureAnchor(el: Element, cache: WeakMap<Element, RepeatSignature | null>): { el: Element; signature: RepeatSignature } | null {
  let node: Element | null = el
  while (node) {
    if (node.getAttribute('data-zone-type') === 'page') break
    const signature = getRepeatSignature(node, cache)
    if (signature) return { el: node, signature }
    node = node.parentElement
  }
  return null
}

function getElementPath(root: Element, target: Element): number[] | null {
  const path: number[] = []
  let node: Element | null = target

  while (node && node !== root) {
    const parent: HTMLElement | null = node.parentElement
    if (!parent) return null
    const index = Array.prototype.indexOf.call(parent.children, node)
    if (index < 0) return null
    path.unshift(index)
    node = parent
  }

  return node === root ? path : null
}

function getElementByPath(root: Element, path: number[]): Element | null {
  let node: Element | null = root
  for (const index of path) {
    const child: Element | undefined = node.children[index]
    if (!(child instanceof Element)) return null
    node = child
  }
  return node
}

function detectRepeatCandidate(
  candidate: Element,
  anchorEl: Element,
  anchorSignature: RepeatSignature,
  cache: WeakMap<Element, RepeatSignature | null>
): RepeatAncestorContext | null {
  const parent = candidate.parentElement
  if (!parent) return null

  const anchorPath = getElementPath(candidate, anchorEl)
  if (!anchorPath) return null

  const children = Array.from(parent.children)

  if (children.length > REPEAT_CONTEXT_MAX_SIBLINGS) {
    return {
      node: candidate,
      total: children.length,
      signature: anchorSignature,
      skipped: true,
    }
  }

  const sameTemplateSiblings = children.filter((child) => {
    const siblingAnchor = child === candidate ? anchorEl : getElementByPath(child, anchorPath)
    return !!siblingAnchor && getRepeatSignature(siblingAnchor, cache)?.key === anchorSignature.key
  })

  if (sameTemplateSiblings.length <= 1) return null

  const index = sameTemplateSiblings.indexOf(candidate)
  if (index === -1) return null

  return {
    node: candidate,
    index: index + 1,
    total: sameTemplateSiblings.length,
    signature: anchorSignature,
  }
}

function collectRepeatAncestorContexts(el: Element): RepeatAncestorContext[] {
  const contexts: RepeatAncestorContext[] = []
  const signatureCache = new WeakMap<Element, RepeatSignature | null>()
  const anchor = findNearestSignatureAnchor(el, signatureCache)
  if (!anchor) return []

  let node: Element | null = anchor.el
  let depth = 0

  while (node && depth < REPEAT_CONTEXT_MAX_DEPTH) {
    if (node.getAttribute('data-zone-type') === 'page') break

    const context = detectRepeatCandidate(node, anchor.el, anchor.signature, signatureCache)
    if (context) contexts.push(context)

    node = node.parentElement
    depth += 1
  }

  return contexts.reverse()
}

function formatRepeatContexts(contexts: RepeatAncestorContext[], indent = '- '): string[] {
  if (!contexts.length) return []

  const lines: string[] = []

  contexts.forEach((context, index) => {
    const loopLabel = contexts.length === 1 ? '循环 JSX' : `第 ${index + 1} 层循环 JSX`
    const signature = context.signature
    const reason = signature ? `，依据：${signature.reason}` : ''

    if (context.skipped) {
      lines.push(`${indent}节点疑似位于${loopLabel}中，父级兄弟节点共 ${context.total} 个，超过扫描上限 ${REPEAT_CONTEXT_MAX_SIBLINGS}，已跳过逐项重复推断${reason}。`)
      return
    }

    if (context.index) {
      lines.push(`${indent}节点疑似位于${loopLabel}中，当前是 JSX 中的第 ${context.index} 项 / 共 ${context.total} 项${reason}。`)
    } else {
      lines.push(`${indent}节点疑似位于${loopLabel}中${reason}。`)
    }
  })

  lines.push(`${indent}注意：需要结合用户需求判断是仅修改当前项，还是修改循环 JSX 中的全部同类项；必要时向用户咨询确认。`)
  return lines
}

export function buildElementRepeatContextInfo(el?: Element) {
  const lines = el ? formatRepeatContexts(collectRepeatAncestorContexts(el), '- ') : []
  const hasRepeatContext = lines.length > 0
  const block = hasRepeatContext
    ? ['- 循环/重复上下文：', ...lines.map((line) => `  ${line}`)].join('\n')
    : '- 循环/重复上下文：未发现疑似循环 JSX / map 重复项'

  return { lines, hasRepeatContext, block }
}

export function getElementLabel(ele: Element | undefined, fallback: string): string {
  return ele?.getAttribute('data-zone-title')?.slice(1) ||
    (ele as HTMLElement | undefined)?.dataset?.zoneTitle?.slice(1) ||
    ele?.classList?.[0] ||
    ele?.tagName?.toLowerCase?.() ||
    fallback
}

function getCurrentText(ele?: Element): string {
  const text = ele?.textContent?.trim().replace(/\s+/g, ' ') ?? ''
  return text || '无可识别文本'
}

export function parseElementInfo(ele: Element | undefined, label: string, options?: { includeCurrentText?: boolean }): ParsedElementInfo {
  const repeatContext = buildElementRepeatContextInfo(ele)
  return {
    name: label,
    codeLocation: getElementCodeLocation(ele),
    domSummary: ele ? extractDomSummary(ele) : '无',
    currentText: options?.includeCurrentText ? getCurrentText(ele) : undefined,
    repeatContextBlock: repeatContext.block,
    hasRepeatContext: repeatContext.hasRepeatContext,
  }
}

export function buildElementDeleteChipData(ele: Element, label = getElementLabel(ele, '节点1')): ParsedElementDeleteChipData {
  const opLabel = '元素删除操作1'
  const target = parseElementInfo(ele, label)
  const changeRequirements = [
    '1. 从 JSX 中完整移除【被删除元素】节点（含其所有子节点）',
    ...(target.hasRepeatContext
      ? ['2. 如果【被删除元素】疑似位于循环 JSX / map 渲染中，默认只删除当前元素对应的数据项或条件分支，不要直接删除整个 map/循环表达式或循环模板节点']
      : []),
    `${target.hasRepeatContext ? 3 : 2}. 同时移除该元素相关的 import 语句（如该组件不再被使用）`,
    `${target.hasRepeatContext ? 4 : 3}. 同时移除该元素独有的样式类定义（如对应 CSS/Less 中仅被该元素使用的类）`,
    `${target.hasRepeatContext ? 5 : 4}. 保持其余元素的顺序、缩进和结构不变`,
  ]
  const notes = [
    ...(target.hasRepeatContext
      ? ['如果无法判断用户是要删除当前这一项，还是删除循环 JSX 中的全部同类项，请先向用户确认，不要贸然移除整个 map/循环结构。']
      : []),
    '如果你认为此操作不合法（例如删除会导致父容器渲染异常），请用一句话向用户说明原因，不要修改任何代码。',
  ]

  return {
    inlineText: `执行「${opLabel}」，`,
    target,
    detailText: [
      `<element-delete-operation id="${opLabel}">`,
      `## 操作意图（${opLabel}）`,
      '用户触发了删除操作，请在 JSX 源码中移除对应的元素节点（含其完整子树）。',
      '',
      '## 被删除元素',
      `- 名称：${target.name}`,
      `- 代码位置：${target.codeLocation}`,
      target.repeatContextBlock,
      '- DOM 结构摘要：',
      indentText(target.domSummary, '  '),
      '',
      '## 修改要求',
      ...changeRequirements,
      '',
      '## 注意',
      ...notes,
      '</element-delete-operation>',
    ].join('\n'),
  }
}

export function buildElementTextUpdateChipData(ele: Element, content: string, label = getElementLabel(ele, '节点1')): ParsedElementTextUpdateChipData {
  const opLabel = '文本修改操作1'
  const target = parseElementInfo(ele, label, { includeCurrentText: true })
  const nextText = content ?? ''
  const changeRequirements = [
    '1. 只修改【目标文本元素】对应的文案内容，不重写无关 JSX 结构',
    '2. 将目标文案改为【目标新文案】中给出的完整内容；如果包含换行，按现有项目文本换行习惯处理（如 <br/> 或字符串换行）',
    ...(target.hasRepeatContext
      ? ['3. 如果【目标文本元素】疑似位于循环 JSX / map 渲染中，默认只修改当前元素对应的数据项或条件分支，不要直接修改整个 map 模板导致全部同类项文案变化']
      : []),
    `${target.hasRepeatContext ? 4 : 3}. 保持该元素的组件、属性、样式类名、事件绑定和相邻元素结构不变`,
    `${target.hasRepeatContext ? 5 : 4}. 不要因为只改文案而新增无关组件、状态或样式`,
  ]
  const notes = [
    ...(target.hasRepeatContext
      ? ['如果无法判断用户是要只修改当前这一项，还是修改循环 JSX 中的全部同类项，请先向用户确认，不要贸然改动整个 map/循环模板。']
      : []),
    '如果无法在源码中可靠定位该文本，请用一句话向用户说明原因，不要修改任何代码。',
  ]

  return {
    inlineText: `执行「${opLabel}」，`,
    target,
    content: nextText,
    detailText: [
      `<element-text-update-operation id="${opLabel}">`,
      `## 操作意图（${opLabel}）`,
      '用户触发了文本修改操作，请在 JSX 源码中把目标文本元素的文案改为指定新文案。',
      '',
      '## 目标文本元素',
      `- 名称：${target.name}`,
      `- 代码位置：${target.codeLocation}`,
      `- 当前 DOM 文本：${target.currentText ?? '无可识别文本'}`,
      target.repeatContextBlock,
      '- DOM 结构摘要：',
      indentText(target.domSummary, '  '),
      '',
      '## 目标新文案',
      nextText || '（空文本）',
      '',
      '## 修改要求',
      ...changeRequirements,
      '',
      '## 注意',
      ...notes,
      '</element-text-update-operation>',
    ].join('\n'),
  }
}

export function buildElementMoveChipData(
  fromEle: Element,
  toEle: Element,
  placement: 'before' | 'after',
  fromLabel = getElementLabel(fromEle, '节点1'),
  toLabel = getElementLabel(toEle, '节点2')
): ParsedElementMoveChipData {
  const opLabel = '元素移动操作1'
  const direction = PLACEMENT_LABEL[placement] ?? placement
  const from = parseElementInfo(fromEle, fromLabel)
  const to = parseElementInfo(toEle, toLabel)
  const hasRepeatContext = from.hasRepeatContext || to.hasRepeatContext
  const changeRequirements = [
    '1. 只移动【被拖拽元素】的 JSX 节点（含其完整子树），不修改任何属性或样式',
    `2. 将【被拖拽元素】放到【参照元素】的${direction}`,
    ...(hasRepeatContext
      ? ['3. 如果任一元素疑似位于循环 JSX / map 渲染中，默认只调整当前元素对应的数据项或条件分支的顺序，不要直接移动整个 map/循环表达式或循环模板节点']
      : []),
    `${hasRepeatContext ? 4 : 3}. 保持其余元素的顺序和缩进不变`,
    `${hasRepeatContext ? 5 : 4}. 如果两个元素在不同父容器中，请自行判断最合理的移动方案`,
  ]
  const notes = [
    ...(hasRepeatContext
      ? ['如果无法判断用户是要只移动当前这一项，还是调整循环 JSX 中的全部同类项顺序，请先向用户确认，不要贸然改动整个 map/循环模板。']
      : []),
    '如果你认为此操作不合法，请用一句话向用户说明原因，不要修改任何代码。',
  ]

  return {
    inlineText: `执行「${opLabel}」，`,
    from,
    to,
    placement,
    direction,
    detailText: [
      `<element-move-operation id="${opLabel}" direction="${direction}">`,
      `## 操作意图（${opLabel}）`,
      `用户通过拖拽，将【被拖拽元素】移动到【参照元素】的${direction}，请在 JSX 源码中完成对应的顺序调整。`,
      '',
      '## 被拖拽元素（需要移动）',
      `- 名称：${from.name}`,
      `- 代码位置：${from.codeLocation}`,
      from.repeatContextBlock,
      '- DOM 结构摘要：',
      indentText(from.domSummary, '  '),
      '',
      '## 参照元素（位置不变，作为锚点）',
      `- 名称：${to.name}`,
      `- 代码位置：${to.codeLocation}`,
      to.repeatContextBlock,
      '- DOM 结构摘要：',,
      indentText(to.domSummary, '  '),
      '',
      '## 修改要求',
      ...changeRequirements,
      '',
      '## 注意',
      ...notes,
      '</element-move-operation>',
    ].join('\n'),
  }
}
