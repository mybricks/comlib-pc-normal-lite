import type { LayoutElement } from './layoutTypes'

// layoutPlanning 在进入自由布局时调用这里：先测量子元素，再生成要写入的定位和尺寸属性。
// HTML 使用 offset；外层 SVG 使用外框并还原画布缩放。这里不修改 DOM 或源码。
type StyleChangeItem = { key: string; value: string }

export interface PositionSnapshot {
  /** 准备用于 absolute 定位的 left/top；指定容器时已扣除边框和保留的 margin 的影响。 */
  left: number
  top: number
  /** 当前 offsetWidth/offsetHeight；仅在需要补固定尺寸时使用。 */
  width?: number
  height?: number
}

/** 只接管 HTML 布局中的整个 SVG，不处理 circle/path 等内部图形。 */
export function isLayoutSvg(element: Element): element is SVGSVGElement {
  return element.namespaceURI === 'http://www.w3.org/2000/svg' && element.tagName.toLowerCase() === 'svg'
}

function captureSvgPosition(element: SVGSVGElement, parent?: HTMLElement): PositionSnapshot {
  if (!parent) throw new Error('SVG 定位需要 HTML 父容器')
  const rect = element.getBoundingClientRect()
  const parentRect = parent.getBoundingClientRect()
  const scaleX = parentRect.width / parent.offsetWidth
  const scaleY = parentRect.height / parent.offsetHeight
  if (![scaleX, scaleY].every(scale => Number.isFinite(scale) && scale > 0)) {
    throw new Error('SVG 父容器没有可测量的布局尺寸')
  }
  const computed = element.ownerDocument.defaultView!.getComputedStyle(element)
  // rect 是屏幕坐标，先还原缩放，再扣除父边框、保留的 margin，并补回滚动偏移。
  // 测整个 SVG 视口，不用 getBBox（后者只含 circle/path 的图形范围）。
  return {
    left: Math.round((rect.left - parentRect.left) / scaleX - parent.clientLeft + parent.scrollLeft - (parseFloat(computed.marginLeft) || 0)),
    top: Math.round((rect.top - parentRect.top) / scaleY - parent.clientTop + parent.scrollTop - (parseFloat(computed.marginTop) || 0)),
    width: Math.round(rect.width / scaleX),
    height: Math.round(rect.height / scaleY),
  }
}

/**
 * 测量子元素切换前的位置，换算成相对 containingBlock 的 left/top。
 * containingBlock 就是正在切换自由布局的父容器；它目前可能还是 static，
 * 所以 DOM 的 offsetParent 可能指向更外层，需要额外换算。
 * 应在父容器从 Flex 变成 block 之前调用，否则读到的已经是布局变化后的位置。
 */
export function capturePositionSnapshot(
  element: LayoutElement | null,
  options: { containingBlock?: HTMLElement } = {},
): PositionSnapshot {
  if (!element) return { left: 0, top: 0 }
  const parent = options.containingBlock
  if (isLayoutSvg(element)) return captureSvgPosition(element, parent)
  let left = element.offsetLeft
  let top = element.offsetTop
  if (parent && element.offsetParent !== parent) {
    // 子元素和目标容器可能各自相对不同的 offsetParent。
    // 沿 offsetParent 链累计坐标，再相减并扣除目标容器边框，得到目标容器内的偏移。
    const origin = (node: HTMLElement) => {
      let x = 0, y = 0
      for (let current: HTMLElement | null = node; current; current = current.offsetParent as HTMLElement | null) {
        x += current.offsetLeft
        y += current.offsetTop
        if (current !== node) { x += current.clientLeft; y += current.clientTop }
      }
      return { x, y }
    }
    const childOrigin = origin(element)
    const parentOrigin = origin(parent)
    left = childOrigin.x - parentOrigin.x - parent.clientLeft
    top = childOrigin.y - parentOrigin.y - parent.clientTop
  }
  if (parent) {
    // 保留子元素原有 margin，所以坐标中要先扣掉它，避免浏览器定位时再叠加一次。
    // 例如原左边缘在 116px、margin-left 为 8px，应写 left:108px，最终左边缘仍是 116px。
    const computed = element.ownerDocument.defaultView!.getComputedStyle(element)
    left -= parseFloat(computed.marginLeft) || 0
    top -= parseFloat(computed.marginTop) || 0
  }
  return { left: Math.round(left), top: Math.round(top), width: Math.round(element.offsetWidth), height: Math.round(element.offsetHeight) }
}

/**
 * 将测量结果转成 position:absolute、left、top，并按需要补 width/height。
 * authoredStyle 是规则中明确声明的尺寸；例如 width:50% 或 120px 会继续保留。
 * 没写尺寸，或写的是 auto/inherit 时，使用测量值补一个 px 尺寸，减少脱离文档流后的大小变化。
 * 这只是当前的基础尺寸策略，退出时不会自动删除这里补上的 width/height。
 */
export function buildAbsolutePositionChanges(snapshot: PositionSnapshot, authoredStyle: Record<string, any>): StyleChangeItem[] {
  const changes: StyleChangeItem[] = [
    { key: 'position', value: 'absolute' },
    { key: 'left', value: `${snapshot.left}px` },
    { key: 'top', value: `${snapshot.top}px` },
  ]
  for (const key of ['width', 'height'] as const) {
    const value = authoredStyle[key]
    if (snapshot[key] != null && (value == null || value === '' || value === 'auto' || value === 'inherit')) {
      changes.push({ key, value: `${snapshot[key]}px` })
    }
  }
  return changes
}
