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