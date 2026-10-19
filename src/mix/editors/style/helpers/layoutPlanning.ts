import { capturePositionSnapshot, buildAbsolutePositionChanges } from './layoutPosition'
import { inspectLayoutTarget } from './layoutStyleSources'
import { resolveLayoutStyleWrites } from './layoutWriteTargets'
import type { LayoutStylePatch, LayoutTargetInfo, LayoutWritePlan } from './layoutTypes'

// 父容器的 --layout-mode: freedom 表示当前使用自由布局，编辑器据此显示按钮高亮。
export const LAYOUT_MODE_KEY = '--layout-mode'
// 子元素的 --layout-item: freedom 表示定位由本次转换添加，退出时允许删除它的定位声明。
const LAYOUT_ITEM_KEY = '--layout-item'

/**
 * 返回 [父容器, 直接子元素1, 直接子元素2, ...]，每项带着自己的 Less 文件和样式来源。
 * 例如父布局引用 Card 组件，只转换 Card 渲染出的根元素，不处理 Card 内部的标题、按钮。
 * 这里先检查每个节点是否可转换；任一节点不支持就抛错，调用方此时还没有写文件。
 * resolveFile 由调用方提供，因此父容器和子组件可以分别写入不同目录下的 Less。
 */
function collectLayoutTargets(
  container: HTMLElement,
  componentId: string,
  entering: boolean,
  resolveFile: (target: HTMLElement) => string,
): LayoutTargetInfo[] {
  if (!container?.isConnected || !componentId) throw new Error('无法定位元素的样式源码，请重新选择容器')
  const children = Array.from(container.children) as HTMLElement[]
  // <div>文字<span /></div> 中的“文字”没有独立 DOM 元素，无法单独写 position/left/top。
  // 忽略缩进换行等空白文本；有实际文字时中止，避免只转换 span 后破坏原布局。
  if (Array.from(container.childNodes).some(node => node.nodeType === 3 && node.textContent?.trim())) {
    throw new Error('当前仅支持有独立 class、由 Less 配置定位的普通子元素')
  }
  return [container, ...children].map(target => {
    if (target.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !target.isConnected || !target.dataset.zoneSelector) {
      throw new Error('当前仅支持有独立 class、由 Less 配置定位的普通子元素')
    }
    const sourceLocation = target.dataset.loc || ''
    const fileName = resolveFile(target)
    if (!fileName) throw new Error('无法确定元素的 Less 文件，请更新组件库后重试')
    const resolution = inspectLayoutTarget(target, componentId)
    if (!resolution.defaultSource) throw new Error('当前仅支持有独立 class、由 Less 配置定位的普通子元素')
    const computed = target.ownerDocument.defaultView!.getComputedStyle(target)
    if (entering && target !== container) {
      // fixed/sticky 有视口定位或滚动吸附语义，当前没有实现将它们转换后再恢复的规则。
      if (['fixed', 'sticky'].includes(computed.position)) throw new Error('当前自由布局暂不支持 fixed 或 sticky 子元素')
      // 例如装饰图原本相对外层页面定位；父容器变成 relative 后，装饰图可能改为相对父容器定位。
      // 当前不会重新换算这类装饰图的坐标，所以只允许 offsetParent 已经是当前容器的情况。
      if (computed.position === 'absolute' && target.offsetParent !== container) throw new Error('已有绝对定位子元素以外层元素为参照，暂不支持本次切换')
    }
    return { target, sourceLocation, fileName, resolution, display: computed.display, position: computed.position }
  })
}

/**
 * 进入时补齐父容器样式：普通容器用 block，行内容器用 inline-block；static 才补 relative。
 * relative 让后续子元素的 left/top 相对这个容器计算，已有的父容器定位方式则继续保留。
 * 退出时直接使用编辑器传来的 display/flexDirection 等修改。
 */
function createContainerStyle(parent: LayoutTargetInfo, patch: LayoutStylePatch, entering: boolean): LayoutStylePatch {
  const style = { ...patch }
  if (entering) {
    // gap、flex-wrap、对齐声明留在 Less 中，切回 Flex 时仍能使用用户原来的配置。
    style.display = ['inline', 'inline-flex', 'inline-block'].includes(parent.display) ? 'inline-block' : 'block'
    if (parent.position === 'static') style.position = 'relative'
  }
  return style
}

/**
 * 普通子元素按当前布局位置生成 absolute + left/top，并加上 --layout-item: freedom。
 * 比如没有 margin 的第二张卡片当前在父容器内横向偏移 120px，就生成 left: 120px。
 * 尺寸是否补固定值由 layoutPosition 决定；返回 null 表示这个节点不需要修改。
 */
function createEnterItemStyle(item: LayoutTargetInfo, container: HTMLElement): LayoutStylePatch | null {
  // 原本就是 absolute 的装饰图保持原样，也不加标记，避免退出时误删用户原有的定位。
  if (item.position === 'absolute') return null
  const authoredStyle = Object.fromEntries(['width', 'height'].map(key => [key, item.resolution.get(key).winner?.value]))
  const snapshot = capturePositionSnapshot(item.target, { containingBlock: container })
  const changes = buildAbsolutePositionChanges(snapshot, authoredStyle)
  return { ...Object.fromEntries(changes.map(change => [change.key, change.value])), [LAYOUT_ITEM_KEY]: 'freedom' }
}

/**
 * 退出时只处理有 --layout-item: freedom 的节点，删除定位属性和标记，让它重新参与普通布局。
 * null 表示“从 Less 删除这项声明”，不是写入 CSS 值 null，也不是强制写 position: static。
 * 当前只清理定位，不恢复切换前的完整样式；转换时补过的 width/height 也会保留。
 */
function createExitItemStyle(item: LayoutTargetInfo): LayoutStylePatch | null {
  if (item.resolution.get(LAYOUT_ITEM_KEY).winner?.value.trim() !== 'freedom') return null
  return { position: null, left: null, top: null, right: null, bottom: null, [LAYOUT_ITEM_KEY]: null }
}

/**
 * 自由布局转换入口，由 styleProxy.changeLayout 调用，返回“各文件、各 selector 要改哪些属性”。
 *
 * containerPatch 来自编辑器的 value.set：
 * - 进入：{ '--layout-mode': 'freedom' }。
 * - 退出到纵向：{ '--layout-mode': null, display: 'flex', flexDirection: 'column' }。
 *
 * 先读父子节点，再生成样式，最后把每个属性分配到对应的源码 selector。
 * 例如父 .layout 写 block/relative，子 .card 写 absolute/left/top；两者可以位于不同 Less。
 * 整个函数只读取页面并生成修改列表。必须全部完成后才能写文件，否则父布局先改变，
 * 后续子元素的测量位置就可能已经不再是用户切换前看到的位置。
 *
 * 后续增加场景：节点限制看 collectLayoutTargets，进入/退出属性看 createEnter/ExitItemStyle，
 * selector 选择看 layoutWriteTargets，文件解析与内容合并看 layoutStyleChange。
 */
export function buildFreedomLayoutPlan(
  container: HTMLElement,
  componentId: string,
  containerPatch: LayoutStylePatch,
  resolveFile: (target: HTMLElement) => string,
): { plan: LayoutWritePlan; containerStyle: LayoutStylePatch } {
  const entering = containerPatch[LAYOUT_MODE_KEY] === 'freedom'
  if (!entering && containerPatch[LAYOUT_MODE_KEY] !== null) throw new Error('不支持的布局标记')
  const targets = collectLayoutTargets(container, componentId, entering, resolveFile)
  const containerStyle = createContainerStyle(targets[0], containerPatch, entering)
  const writes: LayoutWritePlan['writes'] = []
  for (const item of targets) {
    const style = item.target === container
      ? containerStyle
      : entering ? createEnterItemStyle(item, container) : createExitItemStyle(item)
    if (style) writes.push(...resolveLayoutStyleWrites(container, item, style))
  }
  return { plan: { componentId, container, writes }, containerStyle }
}
