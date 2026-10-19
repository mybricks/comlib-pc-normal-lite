import type { LayoutStylePatch, LayoutStyleValue, LayoutStyleWrite, LayoutTargetInfo } from './layoutTypes'

/**
 * 用浏览器里的 selector 查 DOM，用源码 selector 提示错误。
 * 如果当前容器的两张卡片都匹配 .item，给 .item 写 left 会同时移动两张，无法分别保存坐标。
 * 其他容器或页面也复用 .item 则允许，它们继续跟随同一份组件样式同步变化。
 */
function assertUniqueLayoutTarget(container: HTMLElement, target: HTMLElement, selector: string, runtimeSelector: string): void {
  if (!selector || selector === 'inline') throw new Error('当前仅支持有独立 class、由 Less 配置定位的普通子元素')
  let matches: Element[] = []
  try {
    matches = Array.from((target.getRootNode() as Document | ShadowRoot).querySelectorAll(runtimeSelector))
  } catch { /* 无效选择器按无法匹配处理。 */ }
  const localMatches = matches.filter(element => container.contains(element))
  if (localMatches.length !== 1 || localMatches[0] !== target) {
    throw new Error(localMatches.length > 1
      ? `当前布局内有 ${localMatches.length} 个元素共用样式 ${selector}，无法分别写入定位`
      : `样式 ${selector} 无法匹配当前元素，请重新选择容器`)
  }
}

/**
 * 输入是“这个节点要改哪些属性”，输出是“这些属性分别写到它所在 Less 的哪些 selector”。
 * 例如 position 原本由 .card 声明，就修改 .card；left 原本没声明，则使用该节点的默认写入规则。
 * 如果两项最终选中不同的 selector，会返回两条记录；同一 selector 的属性合成一条。
 * 本函数也检查内联样式和 selector 冲突，所有检查完成前都不写文件。
 */
export function resolveLayoutStyleWrites(container: HTMLElement, item: LayoutTargetInfo, style: LayoutStylePatch): LayoutStyleWrite[] {
  const { target, sourceLocation, fileName, resolution } = item
  const grouped = new Map<string, LayoutStyleWrite>()
  const put = (source: { sourceSelector: string; selectorPart: string }, key: string, value: LayoutStyleValue) => {
    const selector = source.sourceSelector
    assertUniqueLayoutTarget(container, target, selector, source.selectorPart)
    const group: LayoutStyleWrite = grouped.get(selector) || { target, sourceLocation, fileName, selector, style: {} }
    group.style[key] = value
    grouped.set(selector, group)
  }

  // data-style-info 记录 JSX style 的源码信息，target.style 则是 DOM 当前的内联声明。
  // 两边都检查：只改 Less 可能被 style 覆盖，用户会看到“写了源码，但页面没变”。
  let inline: Record<string, unknown>
  try { inline = JSON.parse(target.dataset.styleInfo || '{}') } catch {
    throw new Error('元素缺少有效的源码定位信息，无法切换自由布局')
  }
  for (const [key, value] of Object.entries(style)) {
    const propertyName = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
    if (inline[key] || target.style.getPropertyValue(propertyName)) {
      throw new Error('当前仅支持有独立 class、由 Less 配置定位的普通子元素')
    }
    const property = resolution.get(key)
    if (value == null) {
      // 例如 .card 和 .layout .card 都声明了 position:absolute；只删优先级最高的一条，
      // 另一条又会生效。因此删除时要处理该属性的全部候选规则，而不只处理 winner。
      property.candidates.forEach(candidate => put(candidate.source, key, null))
    } else {
      // 已声明的属性在原先生效的规则中修改；新属性才使用默认规则。
      // 原声明带 !important 时继续保留，否则新值可能被其他规则覆盖。
      const source = property.winner?.source || resolution.defaultSource
      if (!source) throw new Error('当前仅支持有独立 class、由 Less 配置定位的普通子元素')
      put(source, key, property.winner?.important ? `${value} !important` : value)
    }
  }
  return Array.from(grouped.values())
}
