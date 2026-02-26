/**
 * 向 JSX 元素的 attributes 中追加 data-xxx 属性（字符串值）
 */
export function pushDataAttr(attributes: any[], name: string, value: string) {
  attributes.push({
    type: "JSXAttribute",
    name: { type: "JSXIdentifier", name },
    value: {
      type: "StringLiteral",
      value,
      extra: { raw: `"${value}"`, rawValue: value },
    },
  });
}

/**
 * 向 JSX 元素的 attributes 中追加 data-xxx 属性（表达式，如变量名）
 */
export function pushDataAttrExpression(attributes: any[], name: string, identifierName: string) {
  attributes.push({
    type: "JSXAttribute",
    name: { type: "JSXIdentifier", name },
    value: {
      type: "JSXExpressionContainer",
      expression: { type: "Identifier", name: identifierName },
    },
  });
}