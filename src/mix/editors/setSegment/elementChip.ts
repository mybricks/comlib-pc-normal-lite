import { randomUUID } from "../../utils/uuid"
import buildDomChipInfo from '../../../helpers/dom/buildDomChipInfo'

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
  child: '内部',
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
  placement: 'before' | 'after' | 'child'
  direction: string
}

export interface ParsedElementInsertChipData extends ParsedElementChipData {
  target: ParsedElementInfo
  placement: 'before' | 'after' | 'child'
  direction: string
  importCode: string
  jsx: string
}

export interface ParsedElementStyleUpdateChipData extends ParsedElementChipData {
  target: ParsedElementInfo
  styles: Array<{ property: string; value: number | string | null }>
}

export interface ParsedElementImageUpdateChipData extends ParsedElementChipData {
  target: ParsedElementInfo
  currentSrc: string
  nextSrc: string
}

export interface ParsedElementSvgUpdateChipData extends ParsedElementChipData {
  target: ParsedElementInfo
  nextSvg: string
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

function toKebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
}

function getElementClassNames(ele?: Element): string {
  if (!ele) return ''
  return Array.from(ele.classList).filter(Boolean).join(' ')
}

/**
 * 类名约定为基础类在前、具体类在后（如 "ant-col ant-form-item-label"），取末位作为可辨识名称。
 * 修饰类以「基础类-」为前缀（如 ant-tabs-tab-active 之于 ant-tabs-tab），先剔除以取到稳定身份，
 * 否则名称会随 hover / 激活 / 加载等状态漂移。
 */
function pickDistinguishingClassName(ele?: Element): string {
  const classes = ele ? Array.from(ele.classList).filter(Boolean) : []
  const baseClasses = classes.filter(
    (cls) => !classes.some((other) => other !== cls && cls.startsWith(`${other}-`)),
  )
  const candidates = baseClasses.length ? baseClasses : classes
  return candidates[candidates.length - 1] ?? ''
}

function getIdentifyingInlineStyle(ele: Element, excludeProperties: string[]): string {
  const style = (ele as HTMLElement).style
  if (!style?.length) return '无'
  const exclude = new Set(excludeProperties)
  const parts: string[] = []
  for (let i = 0; i < style.length; i++) {
    const prop = style.item(i)
    if (!prop || exclude.has(prop)) continue
    const value = style.getPropertyValue(prop)
    if (value) parts.push(`${prop}: ${value}`)
  }
  return parts.length ? parts.join('; ') : '无（除本次目标样式外）'
}

export function getElementLabel(ele: Element | Node | undefined, fallback: string): string {
  if (ele && ele.nodeType !== Node.ELEMENT_NODE) {
    return getElementLabel(ele.parentElement ?? undefined, fallback)
  }

  const element = ele as Element | undefined
  const hasClass = Boolean(element?.classList?.length)
  const getZoneTitle = (title: string | null | undefined) =>
    title ? (hasClass ? title.slice(1) : title) : undefined
  return getZoneTitle(element?.getAttribute('data-zone-title')) ||
    getZoneTitle((element as HTMLElement | undefined)?.dataset?.zoneTitle) ||
    pickDistinguishingClassName(element) ||
    element?.tagName?.toLowerCase?.() ||
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

function getElementLabeForAiRequest(ele: Element | Node) {
  if (ele.nodeType !== Node.ELEMENT_NODE) {
    // const text = ele.textContent?.trim().replace(/\s+/g, ' ').slice(0, 30)
    const parent = ele.parentElement
    const parentLabel = parent ? getElementLabeForAiRequest(parent) : '文本节点'
    return parentLabel
    // return text ? `${parentLabel} 中的文本「${text}」` : `${parentLabel} 中的文本节点`
  }

  const element = ele as Element
  const zoneSelector = element.getAttribute('data-zone-selector')
  const tagName = element.tagName.toLowerCase()
  if (zoneSelector) {
    const selector = JSON.parse(zoneSelector)[0].split(' ').slice(-1)
    return `${tagName}${selector}`
  }

  return `${tagName}${Array.from(element.classList).slice(-1) || ''}`
}

export function buildElementDeleteAiRequest({ ele }: { ele: Element }) {
  const chip = {
    id: randomUUID(),
    label: getElementLabeForAiRequest(ele),
    type: 'dom',
    data: {
      ele,
      info: buildDomChipInfo(ele)
    }
  }

  return {
    type: 'element-delete',
    message: `删除 [[chip:${chip.id}]].`,
    chips: [chip]
  }
}

export function buildElementTextUpdateAiRequest({ ele, content }: { ele: Element; content: string }) {
  const chip = {
    id: randomUUID(),
    label: getElementLabeForAiRequest(ele),
    type: 'dom',
    data: {
      ele,
      info: buildDomChipInfo(ele)
    }
  }

  return {
    type: 'element-text-update',
    message: `将 [[chip:${chip.id}]] 文本修改为「${content}」.`,
    chips: [chip]
  }
}

export function buildElementImageUpdateAiRequest({ ele, src }: { ele: Element; src: string }) {
  const chip = {
    id: randomUUID(),
    label: getElementLabeForAiRequest(ele),
    type: 'dom',
    data: {
      ele,
      info: buildDomChipInfo(ele)
    }
  }

  return {
    type: 'element-image-update',
    message: `将 [[chip:${chip.id}]] 图片地址修改为「${src}」.`,
    chips: [chip]
  }
}

export function buildElementSvgUpdateAiRequest({ ele, svg }: { ele: Element; svg: string }) {
  const chip = {
    id: randomUUID(),
    label: getElementLabeForAiRequest(ele),
    type: 'dom',
    data: {
      ele,
      info: buildDomChipInfo(ele)
    }
  }

  return {
    type: 'element-svg-update',
    message: [
      `将 [[chip:${chip.id}]] JSX 替换为：`,
      `\`\`\``,
      svg,
      `\`\`\``
    ].join('\n'),
    chips: [chip]
  }
}

export function buildElementStyleUpdateAiRequest({ ele, styles }: { ele: Element; styles: Array<{ key: string; value: number | string | null | undefined }>; }) {
  const chip = {
    id: randomUUID(),
    label: getElementLabeForAiRequest(ele),
    type: 'dom',
    data: {
      ele,
      info: buildDomChipInfo(ele)
    }
  }
  const normalizedStyles = styles.map(({ key, value }) => ({
    property: toKebabCase(key),
    value: value ?? null,
  }))

  return {
    type: 'element-style-update',
    message: [`调整 [[chip:${chip.id}]] 样式：`].concat(normalizedStyles.map(({ property, value }) => {
      return value === null || value === undefined || value === '' ? `  - 删除 ${property}` : `  - 更新 ${property} ${typeof value === 'number' ? `${value}px` : value}`
    })).join('\n'),
    chips: [chip]
  }
}

const ELEMENT_MOVE_PLACEMENT_LABEL = {
  before: '前',
  after: '后',
  child: '内'
}

function textNodeDesc(ele: Element | Node) {
  if (ele.nodeType !== Node.ELEMENT_NODE) {
    const text = ele.textContent?.trim().replace(/\s+/g, ' ').slice(0, 30)
    return text ? ` 内的文本节点「${text}」` : ` 内的文本节点`
  }

  return ''
}

export function buildElementMoveAiRequest({ fromEle, toEle, placement }: { fromEle: Element; toEle: Element | Node; placement: 'before' | 'after' | 'child' }) {
  const chipFrom = {
    id: randomUUID(),
    label: getElementLabeForAiRequest(fromEle),
    type: 'dom',
    data: {
      ele: fromEle,
      info: buildDomChipInfo(fromEle)
    }
  }
  const chipTo = {
    id: randomUUID(),
    label: getElementLabeForAiRequest(toEle),
    type: 'dom',
    data: {
      ele: toEle,
      info: buildDomChipInfo(toEle.nodeType === Node.ELEMENT_NODE ? toEle as Element : toEle.parentElement ?? undefined)
    }
  }

  return {
    type: 'element-move',
    message: `将 [[chip:${chipFrom.id}]] 移动到 [[chip:${chipTo.id}]]${textNodeDesc(toEle)} ${ELEMENT_MOVE_PLACEMENT_LABEL[placement]}.`,
    chips: [chipFrom, chipTo]
  }
}

export function buildElementDuplicateAiRequest({ ele }: { ele: Element }) {
  const chip = {
    id: randomUUID(),
    label: getElementLabeForAiRequest(ele),
    type: 'dom',
    data: {
      ele,
      info: buildDomChipInfo(ele)
    }
  }

  return {
    type: 'element-duplicate',
    message: `复制 [[chip:${chip.id}]]，将复制出的完整节点插入到原节点之后，并与原节点保持同级.`,
    chips: [chip]
  }
}

export function buildElementInsertAiRequest({ ele, jsx, placement, importCode = '' }: { ele: Element | Node; jsx: string; placement: 'before' | 'after' | 'child'; importCode?: string }) {
  const chip = {
    id: randomUUID(),
    label: getElementLabeForAiRequest(ele),
    type: 'dom',
    data: {
      ele,
      info: buildDomChipInfo(ele.nodeType === Node.ELEMENT_NODE ? ele as Element : ele.parentElement ?? undefined)
    }
  }

  return {
    type: 'element-insert',
    message: [
      `在 [[chip:${chip.id}]]${textNodeDesc(ele)} ${ELEMENT_MOVE_PLACEMENT_LABEL[placement]} 插入 JSX 片段：`,
      `\`\`\``,
      importCode,
      jsx,
      `\`\`\``
    ].filter((str) => !!str).join('\n'),
    chips: [chip]
  }
}
