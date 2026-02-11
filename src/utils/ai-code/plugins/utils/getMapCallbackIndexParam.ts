const MAP_INDEX_INJECTED_NAME = "__mapIndex";

/**
* 若当前 JSX 位于 .map((item) => ...) 或 .map((item, index) => ...) 的回调内，
* 返回用于 data-index 的 index 变量名（已有第二参数则用其名，否则注入 __mapIndex）。
* 为 data-map-index 赋值，用于map渲染的元素能够正确映射到数据维度上的索引。
*/
export function getMapCallbackIndexParam(path: { findParent: (fn: (p: any) => boolean) => any; node: any }): string | null {
 const mapPath = path.findParent((p: any) => {
   const n = p?.node;
   if (!n || n.type !== "CallExpression") return false;
   const callee = n.callee;
   if (callee?.type !== "MemberExpression" || callee?.property?.name !== "map") return false;
   const callback = n.arguments?.[0];
   if (!callback || !callback.params?.length) return false;
   return true;
 });
 if (!mapPath?.node) return null;
 const callback = mapPath.node.arguments[0];
 const params = callback.params;
 if (params[1]) {
   if (params[1].type === "Identifier") return params[1].name;
   return null;
 }
 // 只有单参数 (item) => ...：注入第二参数，运行时 map 会传入 (element, index)
 params.push({ type: "Identifier", name: MAP_INDEX_INJECTED_NAME });
 return MAP_INDEX_INJECTED_NAME;
}