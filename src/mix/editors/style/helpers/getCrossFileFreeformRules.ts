import context, { config } from '../../../context'
import { resolveLessFilePath } from './resolveLessFilePath'

/** 跨文件 freeform 的布局规则归父容器文件，供拖动和缩放复用原有写回链路。 */
export function getCrossFileFreeformRules(ele: HTMLElement, lessFile: string, shadowRoot: ParentNode): CSSStyleRule[] {
  const parent = ele.parentElement!
  // 只处理源码父容器下的跨文件子元素。
  if (!parent.dataset.loc) return []
  const parentLess = resolveLessFilePath(
    JSON.parse(parent.dataset.loc).files.less,
    context.component!.params.data.files, config.getEntryFile(),
  )
  if (parentLess === lessFile) return []

  const parentStyleID = `${context.component!.params.id}_${parentLess}`.replace(/\./g, '__').replace(/\//g, '_')
  const parentSheet = shadowRoot.querySelector<HTMLStyleElement>(`#${parentStyleID}`)?.sheet
  const rules = Array.from(parentSheet?.cssRules ?? [])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)

  // 自定义属性会继承，必须分别命中父容器和子元素自身的标记规则。
  if (!rules.some(rule => rule.style.getPropertyValue('--layout-mode').trim() === 'freedom' && parent.matches(rule.selectorText))) {
    return []
  }
  return rules.filter(rule => rule.style.getPropertyValue('--freeform-position').trim() === 'absolute' && ele.matches(rule.selectorText))
}
