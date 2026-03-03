export function findRelyAndSource(relyName, importRelyMap) {
  const value = importRelyMap.get(relyName);
  if (value == null) {
    return { relyName, source: "html" };
  }
  // value 可能是 source（直接 import），也可能是另一个 relyName（解构自 Typography.Text）
  const nextValue = importRelyMap.get(value);
  if (nextValue !== undefined) {
    // value 仍是 relyName，继续递归，最终返回链末的 { relyName, source }
    return findRelyAndSource(value, importRelyMap);
  }
  // value 是 source，relyName 即为最后一个从 source 解构出来的 relyName
  // 除了三方库，就是html
  return { relyName, source: value || "html" };
}

/**
 * 从 JSX 标签名节点得到字符串：JSXIdentifier => name，JSXMemberExpression => "Foo.Bar"
 */
export function getJSXElementNameString(nameNode: any): string | null {
  if (!nameNode) return null;
  if (nameNode.type === "JSXIdentifier") {
    return nameNode.name ?? null;
  }
  if (nameNode.type === "JSXMemberExpression") {
    const objectPart = getJSXElementNameString(nameNode.object);
    const propertyPart = nameNode.property?.type === "JSXIdentifier" ? nameNode.property.name : null;
    if (objectPart != null && propertyPart != null) return `${objectPart}.${propertyPart}`;
    return objectPart ?? propertyPart;
  }
  return null;
}