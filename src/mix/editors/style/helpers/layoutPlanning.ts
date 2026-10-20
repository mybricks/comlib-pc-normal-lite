import { capturePositionSnapshot, buildAbsolutePositionChanges, isLayoutSvg } from './layoutPosition'
import { inspectLayoutTarget } from './layoutStyleSources'
import { prepareLayoutTarget, resolveLayoutStyleWrites } from './layoutWriteTargets'
import type { LayoutElement, LayoutJsxAnchor, LayoutStylePatch, LayoutTargetInfo, LayoutWritePlan } from './layoutTypes'

// 父容器的 --layout-mode: freedom 表示当前使用自由布局，编辑器据此显示按钮高亮。
export const LAYOUT_MODE_KEY = '--layout-mode'
// 子元素的 --layout-item: freedom 表示定位由本次转换添加，退出时允许删除它的定位声明。
const LAYOUT_ITEM_KEY = '--layout-item'

/**
 * 返回 [父容器, 直接子元素1, 直接子元素2, ...]，每项带着可用的 Less / JSX 来源。
 * 例如父布局引用 Card 组件，只转换 Card 渲染出的根元素，不处理 Card 内部的标题、按钮。
 * 逐个收集可写节点；不可写的子节点跳过，父容器不可写才停止切换。
 * resolveFile 由调用方提供，因此父容器和子组件可以分别写入不同目录下的源码。
 */
function collectLayoutTargets(
  container: HTMLElement,
  componentId: string,
  resolveFile: (target: LayoutElement) => string | undefined,
  resolveJsx?: (target: LayoutElement) => LayoutJsxAnchor | undefined,
): LayoutTargetInfo[] {
  if (!container?.isConnected || !componentId) throw new Error('无法定位元素的样式源码，请重新选择容器')
  const children = Array.from(container.children) as LayoutElement[]
  // 裸文本没有独立 style，继续留在文档流中，不影响其他子元素转换。
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 3 && node.textContent?.trim()) {
      prepareLayoutTarget(container, node, () => { throw new Error('裸文本没有独立样式，已跳过') })
    }
  }
  return [container, ...children].flatMap(target => {
    const item = prepareLayoutTarget(container, target, () => {
      if (!target.isConnected || (target.namespaceURI !== 'http://www.w3.org/1999/xhtml' &&
        !(target !== container && isLayoutSvg(target) && container.namespaceURI === 'http://www.w3.org/1999/xhtml'))) {
        throw new Error('当前节点需要独立 HTML 元素或外层 SVG 和可写源码')
      }
      const sourceLocation = target.dataset.loc || ''
      // Less / JSX 是备选来源，一条路径解析失败不应阻止另一条可写路径。
      const sourceErrors: unknown[] = []
      const trySource = <T>(resolve: () => T): T | undefined => {
        try { return resolve() } catch (error) { sourceErrors.push(error); return undefined }
      }
      const jsx = trySource(() => resolveJsx?.(target))
      const fileName = trySource(() => resolveFile(target))
      const resolution = inspectLayoutTarget(target, componentId)
      if (!jsx && (!fileName || !resolution.defaultSource)) {
        throw sourceErrors[0] || new Error('当前节点没有可写的 Less 或原生 JSX 来源')
      }
      const computed = target.ownerDocument.defaultView!.getComputedStyle(target)

      return { target, sourceLocation, fileName, jsx, resolution, display: computed.display, position: computed.position }
    })
    return item ? [item] : []
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
  if (['fixed', 'sticky'].includes(item.position)) throw new Error('fixed / sticky 子元素暂不接管定位')
  if (item.position === 'absolute' && !isLayoutSvg(item.target) && item.target.offsetParent !== container) {
    throw new Error('已有 absolute 子元素以外层元素为参照，已跳过')
  }
  // 原本就是 absolute 的装饰图保持原样，也不加标记，避免退出时误删用户原有的定位。
  if (item.position === 'absolute') return null
  const authoredStyle = Object.fromEntries(['width', 'height'].map(key => [key,
    item.resolution.ownValue(key) ?? (isLayoutSvg(item.target) ? item.target.getAttribute(key) : undefined),
  ]))
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
  if (item.resolution.ownValue(LAYOUT_ITEM_KEY)?.trim() !== 'freedom') return null
  return { position: null, left: null, top: null, right: null, bottom: null, [LAYOUT_ITEM_KEY]: null }
}

/**
 * 自由布局转换入口，由 styleProxy.changeLayout 调用，返回“各文件、各节点要改哪些属性”。
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
  resolveFile: (target: LayoutElement) => string | undefined,
  resolveJsx?: (target: LayoutElement) => LayoutJsxAnchor | undefined,
): { plan: LayoutWritePlan; containerStyle: LayoutStylePatch } {
  const entering = containerPatch[LAYOUT_MODE_KEY] === 'freedom'
  if (!entering && containerPatch[LAYOUT_MODE_KEY] !== null) throw new Error('不支持的布局标记')
  const targets = collectLayoutTargets(container, componentId, resolveFile, resolveJsx)
  const containerStyle = createContainerStyle(targets[0], containerPatch, entering)
  // 重复 JSX 来源整组跳过，不能先给第一个实例写入坐标，再跳过后续实例。
  const anchorKey = (item: LayoutTargetInfo) => item.jsx
    ? `${item.jsx.fileName}:${item.jsx.openingStart}:${item.jsx.openingEnd}` : undefined
  const anchorCounts = new Map<string, number>()
  for (const item of targets) {
    const key = anchorKey(item)
    if (key) anchorCounts.set(key, (anchorCounts.get(key) || 0) + 1)
  }
  const writes: LayoutWritePlan['writes'] = []
  for (const item of targets) {
    const prepared = prepareLayoutTarget(container, item.target, () => {
      if ((anchorCounts.get(anchorKey(item) || '') || 0) > 1) {
        throw new Error('同一 JSX 节点在当前容器内重复渲染，已跳过全部实例')
      }
      const style = item.target === container
        ? containerStyle
        : entering ? createEnterItemStyle(item, container) : createExitItemStyle(item)
      return style ? resolveLayoutStyleWrites(container, item, style, entering) : []
    })
    if (prepared) writes.push(...prepared)
  }
  return { plan: { componentId, container, writes }, containerStyle }
}
