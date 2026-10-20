import type { LayoutElement, LayoutInlineWrite, LayoutReplacement } from './layoutTypes'
import type { LayoutJsxReader } from './layoutJsxSource'

function printStylePropertyName(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
}

/** 自身内联标记识别受管理节点，不读取可继承的 computed 自定义属性。 */
export function hasInlineLayout(target: LayoutElement): boolean {
  return ['--layout-item', '--layout-mode'].some(key => target.style.getPropertyValue(key).trim() === 'freedom')
}

function unwrap(node: any): any {
  return ['TSAsExpression', 'TSTypeAssertion', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(node?.type)
    ? unwrap(node.expression) : node
}

function isStatic(node: any): boolean {
  return ['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(node?.type) ||
    (node?.type === 'TemplateLiteral' && !node.expressions.length) ||
    (node?.type === 'UnaryExpression' && ['-', '+'].includes(node.operator) && node.argument.type === 'NumericLiteral')
}

/** 仅修改 style 属性，无关 JSX 属性及动态表达式保持原样；不向页面注入恢复数据。 */
export function prepareLayoutInlineWrite(write: LayoutInlineWrite, reader: LayoutJsxReader): LayoutReplacement[] {
  const { source, opening } = reader.opening(write.anchor)
  if (opening.attributes.some((attr: any) => attr.type === 'JSXSpreadAttribute')) throw new Error('含 JSX 属性展开的节点需要动态样式支持')
  const attributes = opening.attributes.filter((attr: any) => attr.name?.name === 'style')
  if (attributes.length > 1) throw new Error('JSX 存在重复的 style 属性')
  const styleAttr = attributes[0]
  const expression = styleAttr?.value?.type === 'JSXExpressionContainer' ? styleAttr.value.expression : undefined
  const object = unwrap(expression)
  if (styleAttr && object?.type !== 'ObjectExpression') throw new Error('动态 style 表达式需要后续的合并支持')
  const properties = new Map<string, any>()
  for (const prop of object?.properties || []) {
    const key = prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.value
    if (prop.type !== 'ObjectProperty' || prop.computed || typeof key !== 'string' || properties.has(key)) {
      throw new Error('style 含展开、计算属性或重复属性，无法独立保存布局')
    }
    properties.set(key, prop)
  }
  const patch = { ...write.style }
  if (write.operation === 'enter' && write.role === 'item') Object.assign(patch, { right: 'auto', bottom: 'auto' })
  // 动态 inset 可能影响定位；静态简写保留，生成的长属性排在最后。
  const inspectedKeys = new Set([...Object.keys(patch), ...(write.operation === 'enter' ? ['inset', 'insetBlock', 'insetInline'] : [])])
  for (const key of inspectedKeys) {
    if (properties.has(key) && !isStatic(properties.get(key).value)) throw new Error(`动态定位属性 ${key} 需要后续的合并支持`)
  }
  const parts: string[] = []
  for (const [key, prop] of properties) {
    if (!(key in patch)) parts.push(source.slice(prop.start, prop.end))
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value != null) parts.push(`${printStylePropertyName(key)}: ${JSON.stringify(value)}`)
  }
  const objectText = `{ ${parts.join(', ')} }`
  const expressionText = object
    ? source.slice(expression.start, object.start) + objectText + source.slice(object.end, expression.end)
    : objectText
  const text = parts.length ? `style={${expressionText}}` : ''
  if (styleAttr) return [{ start: styleAttr.start, end: styleAttr.end, text }]
  const end = opening.end - (opening.selfClosing ? 2 : 1)
  return text ? [{ start: end, end, text: ` ${text} ` }] : []
}

/** 全部范围来自同一个原文件，倒序应用，拒绝重叠写入。 */
export function applyLayoutReplacements(source: string, replacements: LayoutReplacement[]): string {
  let current = source, boundary = source.length
  for (const item of [...replacements].sort((a, b) => b.start - a.start)) {
    if (item.start < 0 || item.end < item.start || item.end > boundary) throw new Error('JSX 写入范围重叠或失效')
    current = current.slice(0, item.start) + item.text + current.slice(item.end)
    boundary = item.start
  }
  return current
}
