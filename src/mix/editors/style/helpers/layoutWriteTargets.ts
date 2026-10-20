import { hasInlineLayout } from './layoutInlineStyle'
import type { LayoutElement, LayoutStylePatch, LayoutStyleValue, LayoutStyleWrite, LayoutLessWrite, LayoutTargetInfo } from './layoutTypes'

/** 子节点不可写时跳过；父容器不可写时仍停止切换。仅用于写文件前的准备过程。 */
export function prepareLayoutTarget<T>(container: Element, target: Node, prepare: () => T): T | undefined {
  try { return prepare() } catch (error) {
    if (target === container) throw error
    console.warn('[freedom-layout][skip]', { target, reason: error instanceof Error ? error.message : String(error) })
    return undefined
  }
}

/** 文件相同不代表是同一节点，必须同时比较 JSX 范围和开标签位置。 */
function jsxSourceKey(target: Element | null): string | undefined {
  try {
    const loc = JSON.parse(target?.getAttribute('data-loc') || '')
    if (typeof loc.files?.jsx !== 'string' || !loc.files.jsx ||
      !Number.isInteger(loc.jsx?.start) || !Number.isInteger(loc.jsx?.end) || !Number.isInteger(loc.tag?.end) ||
      loc.jsx.start < 0 || loc.tag.end <= loc.jsx.start || loc.tag.end > loc.jsx.end) return undefined
    return JSON.stringify([loc.files.jsx, loc.jsx.start, loc.jsx.end, loc.tag.end])
  } catch { return undefined }
}

function uniquelyMatches(container: HTMLElement, target: LayoutElement, selector: string): boolean {
  try {
    const matches = Array.from((target.getRootNode() as Document | ShadowRoot).querySelectorAll(selector))
    if (!matches.includes(target)) return false
    const targetSource = jsxSourceKey(target)
    const containerSource = jsxSourceKey(container)
    return matches.every(element => {
      if (element === target) return true
      // 同一容器内的多个匹配必须各写内联；容器外也不能仅因 class 相同就共享定位。
      if (container.contains(element) || !targetSource || jsxSourceKey(element) !== targetSource) return false
      // 保留同一组件重复引用的同步行为，但子元素和它的直接父容器都必须同源。
      return target === container || (!!containerSource && jsxSourceKey(element.parentElement) === containerSource)
    })
  } catch { return false }
}

/** 同一节点的布局字段整体选择写入路径，任何共享规则都不会被局部改写。 */
export function resolveLayoutStyleWrites(
  container: HTMLElement, item: LayoutTargetInfo, style: LayoutStylePatch, entering: boolean,
): LayoutStyleWrite[] {
  const { target, sourceLocation, fileName, resolution } = item
  let inline: Record<string, unknown>
  try { inline = JSON.parse(target.dataset.styleInfo || '{}') } catch { throw new Error('元素缺少有效的内联源码信息') }
  const grouped = new Map<string, LayoutLessWrite>()
  const managed = hasInlineLayout(target)
  // right/bottom/inset 也属于本次定位组，不能留给内联值覆盖 Less 的新坐标。
  const affected = new Set([...Object.keys(style), ...(target !== container ? ['right', 'bottom', 'inset', 'insetBlock', 'insetInline'] : [])])
  let useInline = managed || !fileName || !resolution.defaultSource || [...affected].some(key =>
    inline[key] || target.style.getPropertyValue(key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())))
  const put = (source: { sourceSelector: string; selectorPart: string }, key: string, value: LayoutStyleValue) => {
    if (!uniquelyMatches(container, target, source.selectorPart)) useInline = true
    const selector = source.sourceSelector
    const group = grouped.get(selector) || { kind: 'less' as const, target, sourceLocation, fileName: fileName!, selector, style: {} }
    group.style[key] = value
    grouped.set(selector, group)
  }
  for (const [key, value] of Object.entries(style)) {
    const property = resolution.get(key)
    if (value == null) property.candidates.forEach(candidate => put(candidate.source, key, null))
    else {
      const source = property.winner?.source || resolution.defaultSource
      if (!source) { useInline = true; continue }
      put(source, key, property.winner?.important ? `${value} !important` : value)
    }
  }
  if (!useInline) return Array.from(grouped.values())
  if (!item.jsx) throw new Error('该元素的样式不能独立写入 Less，且缺少可写的原生 JSX 节点')
  // inline 无法覆盖 stylesheet !important；不得提交一个视觉上不会生效的计划。
  for (const key of affected) {
    if (resolution.hasImportantDeclaration(key)) {
      throw new Error(`布局属性 ${key} 受 !important 规则控制，需要专用覆盖策略`)
    }
  }
  return [{ kind: 'jsx-inline', target, sourceLocation, fileName: item.jsx.fileName, anchor: item.jsx,
    role: target === container ? 'container' : 'item', operation: entering ? 'enter' : 'exit', style }]
}
