import type { LayoutStyleWrite } from './layoutTypes'
import {
  classifyNormalFlowSize, classifyFlexMainSize, classifyFlexCrossSize, decideAxisProtection,
  getFlexMainAxis, isFlexDisplay, pixels, unknownSize,
} from './layoutSizeRules'
import type { SizeAxis, SizeOrigin, SizeStyle } from './layoutSizeRules'

// Typed OM 保留 auto / 百分比；getComputedStyle 的使用尺寸只用于生成下限。
type SizeElement = Element & { computedStyleMap?: () => { get(key: string): { toString(): string } } }
export type ContainerSizePatch = Partial<Record<'minWidth' | 'minHeight', string>>
type SizeDiagnostic = { axis: SizeAxis; reason: string }

/** 单次转换缓存 CSS 事实，不跨操作保留 DOM 或样式快照。 */
function createSizeReader(container: HTMLElement) {
  const view = container.ownerDocument.defaultView!
  const styles = new Map<Element, SizeStyle>()
  function readStyle(element: SizeElement): SizeStyle {
    const cached = styles.get(element)
    if (cached) return cached
    const css = view.getComputedStyle(element)
    const typed = element.computedStyleMap?.()
    const style: SizeStyle = {
      width: typed?.get('width').toString(), height: typed?.get('height').toString(),
      minWidth: css.minWidth, minHeight: css.minHeight,
      display: css.display, position: css.position, writingMode: css.writingMode,
      aspectRatio: css.aspectRatio, float: css.cssFloat,
      flexDirection: css.flexDirection, flexWrap: css.flexWrap,
      flexGrow: Number(css.flexGrow), flexShrink: Number(css.flexShrink), flexBasis: css.flexBasis,
      alignSelf: css.alignSelf, alignItems: css.alignItems,
      autoMarginWidth: ['margin-left', 'margin-right'].some(key => typed?.get(key).toString() === 'auto'),
      autoMarginHeight: ['margin-top', 'margin-bottom'].some(key => typed?.get(key).toString() === 'auto'),
      overflowX: css.overflowX, overflowY: css.overflowY,
    }
    styles.set(element, style)
    return style
  }
  function readOrigin(element: Element, axis: SizeAxis): SizeOrigin {
    const style = readStyle(element)
    if (!style[axis]) return unknownSize('环境不支持读取尺寸声明')
    if (['absolute', 'fixed'].includes(style.position) || style.float !== 'none' ||
      style.writingMode !== 'horizontal-tb' || style.aspectRatio !== 'auto' ||
      /table|contents/.test(style.display) || style.display === 'inline') {
      return unknownSize('特殊定位、盒子类型、比例或书写方向尚未支持')
    }
    const parent = element.parentElement
    const parentStyle = parent ? readStyle(parent) : undefined
    if (parentStyle && /grid|table|contents/.test(parentStyle.display)) return unknownSize('外层 Grid / table / contents 尚未支持')
    // 独立长度无需追溯祖先；Flex 主轴例外，仍可能参与收缩和自动 minimum。
    const flexParent = parentStyle && isFlexDisplay(parentStyle.display) ? parentStyle : undefined
    if (pixels(style[axis]!) !== undefined && (!flexParent || axis !== getFlexMainAxis(flexParent.flexDirection))) {
      return { kind: 'external', reason: '明确尺寸' }
    }
    const parentOrigin = parent ? readOrigin(parent, axis)
      : axis === 'width' ? { kind: 'external' as const, reason: '初始包含块宽度' } : unknownSize('缺少高度参照')
    if (!flexParent) return classifyNormalFlowSize(style, axis, parentOrigin)
    if (axis !== getFlexMainAxis(flexParent.flexDirection)) {
      return classifyFlexCrossSize(style, flexParent, axis, parentOrigin)
    }
    if (flexParent.flexWrap !== 'nowrap') return unknownSize('多行 Flex 主轴分配尚未支持')
    const stableSiblings = Array.from(parent!.children).every(sibling => {
      if (sibling === element) return true
      const siblingStyle = readStyle(sibling)
      return siblingStyle.display === 'none' || ['absolute', 'fixed'].includes(siblingStyle.position) ||
        (siblingStyle.flexGrow === 0 && siblingStyle.flexShrink === 0)
    })
    const hasText = Array.from(parent!.childNodes).some(node => node.nodeType === 3 && !!node.textContent?.trim())
    const hasPseudo = ['::before', '::after'].some(pseudo => {
      const css = view.getComputedStyle(parent!, pseudo)
      return css.content && !['none', 'normal'].includes(css.content) && css.display !== 'none' && !['absolute', 'fixed'].includes(css.position)
    })
    return classifyFlexMainSize(style, axis, parentOrigin, stableSiblings && !hasText && !hasPseudo)
  }
  return { readStyle, readOrigin }
}

/** 与 min-width/min-height 同一盒模型的 CSS 尺寸，避开画布 transform 的屏幕缩放。 */
export function readCssBoxSize(container: HTMLElement, axis: SizeAxis): number {
  const css = container.ownerDocument.defaultView!.getComputedStyle(container)
  const resolved = pixels(css.getPropertyValue(axis))
  if (resolved !== undefined) return resolved
  const sides = axis === 'width' ? ['left', 'right'] : ['top', 'bottom']
  const extra = css.getPropertyValue('box-sizing') === 'border-box' ? 0 : sides.reduce((sum, side) => sum +
    (parseFloat(css.getPropertyValue(`padding-${side}`)) || 0) + (parseFloat(css.getPropertyValue(`border-${side}-width`)) || 0), 0)
  return Math.max(0, (axis === 'width' ? container.offsetWidth : container.offsetHeight) - extra)
}

/** 只为实际接受的文档流转换补尺寸；两轴独立，一轴未知不阻止另一轴保护。 */
export function planContainerSizeProtection(container: HTMLElement, writes: LayoutStyleWrite[]): {
  patch: ContainerSizePatch; diagnostics: SizeDiagnostic[];
} {
  const { readStyle, readOrigin } = createSizeReader(container)
  const patch: ContainerSizePatch = {}, diagnostics: SizeDiagnostic[] = []
  const removesFlow = writes.some(write => {
    if (write.target.parentElement !== container || !/^absolute(?:\s*!important)?$/.test(String(write.style.position))) return false
    const css = readStyle(write.target)
    return css.display !== 'none' && !['absolute', 'fixed'].includes(css.position)
  })
  if (!removesFlow) return { patch, diagnostics }
  const style = readStyle(container)
  for (const axis of ['width', 'height'] as const) {
    const key = axis === 'width' ? 'minWidth' : 'minHeight'
    const minimum = !style[key] || style[key] === 'auto' ? 0 : pixels(style[key])
    const decision = decideAxisProtection(readOrigin(container, axis), readCssBoxSize(container, axis), minimum)
    if (decision.kind === 'protect') patch[key] = decision.value
    else if (decision.kind === 'unknown') diagnostics.push({ axis, reason: decision.reason })
  }
  return { patch, diagnostics }
}
