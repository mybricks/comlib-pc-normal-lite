/**
 * 允许格式化的自闭合标签（不包含文本内容的标签）
 */
const FORMATTING_TAGS = new Set(['br']);

/**
 * 判断是否是格式化标签（自闭合且不包含文本）
 */
function isFormattingTag(child: any): boolean {
  if (child.type !== "JSXElement") {
    return false;
  }
  
  // 获取标签名
  const tagName = child.openingElement?.name?.name;
  
  // 检查是否是允许的格式化标签
  return FORMATTING_TAGS.has(tagName);
}

export function hasEditableTextContent(jsxElement: any): boolean | { jsx: { start: number, end: number }} {
  const children = jsxElement.children;
  
  if (!children || children.length === 0) {
    return false;
  }

  let hasNonEmptyText = false;

  for (const child of children) {
    // 允许 JSXText 节点
    if (child.type === "JSXText") {
      if (child.value && child.value.trim()) {
        hasNonEmptyText = true;
      }
      continue;
    }

    // 允许格式化标签（br, hr 等）
    if (isFormattingTag(child)) {
      continue;  // 跳过，继续检查其他子节点
    }

    // 遇到其他 JSXElement 或表达式，返回 false
    return false;
  }

  if (hasNonEmptyText) {
    return {
      jsx: {
        start: children[0].start,
        end: children[children.length - 1].end
      }
    }
  }

  return hasNonEmptyText;
}