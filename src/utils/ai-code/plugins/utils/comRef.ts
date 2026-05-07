import * as types from "../types";
import { parseJSDocComment } from "./jsdoc";


type InternalRefKind = "comRef" | "pageRef" | "popupRef";

/**
 * 从「组件定义」AST 节点上，取出 comRef(...) / pageRef(...) 对应的调用节点（CallExpression）。
 *
 * 为什么需要：组件有两种写法，AST 结构不同，但都要拿到「ref 的调用」才能继续找函数体、return、根 JSX。
 * - const MainBtn = comRef(() => {...})  → 调用在 VariableDeclarator.init 上
 * - export default comRef(() => {...})   → 调用在 ExportDefaultDeclaration.declaration 上
 */
function getRefCallFromComponentPath(componentPath: any, refKind: InternalRefKind): any {
  const node = componentPath.node;
  let call: any = null;
  if (node.type === "VariableDeclarator") call = node.init;
  else if (node.type === "ExportDefaultDeclaration") call = node.declaration;
  if (!call || call.type !== "CallExpression" || !call.arguments?.[0]) return null;
  let isMatch;
  switch (refKind) {
    case 'comRef':
      isMatch = isComRefCall(call.callee)
      break
    case 'pageRef':
      isMatch = isPageRefCall(call.callee)
      break
    case 'popupRef':
      isMatch = isPopupRefCall(call.callee)
      break
    default:
      break
  }
  return isMatch ? call : null;
}

/**
 * 拿到「组件根节点」：即 comRef/pageRef 里那个函数 return 出来的「最外层一个 JSX 元素」。
 *
 * 用途：只有这个根节点会挂 JSDoc（summary、props），子节点不挂，所以要先算出根是谁。
 *
 * 步骤简述：
 * 1. 从组件定义拿到 ref(...) 的调用，再取第一个参数（箭头函数/普通函数）
 * 2. 从函数体里找到 return 的表达式（有花括号时找 ReturnStatement.argument，否则箭头函数体就是 return 值）
 * 3. 剥掉外层括号：return ( <div> ) 在 AST 里是 ParenthesizedExpression，要取 .expression 直到得到 JSXElement
 * 4. 只有最外层是「单个 JSX 元素」才返回；如果是 Fragment（<>...</>）或别的类型就返回 null
 */
function getComponentRootJSXNode(componentPath: any, refKind: InternalRefKind): any {
  const call = getRefCallFromComponentPath(componentPath, refKind);
  if (!call) return null;
  const fn = call.arguments[0];
  const body = fn?.body;
  if (!body) return null;

  // 从函数体里拿到 return 的表达式
  let returnExpr: any = null;
  if (fn.type === "ArrowFunctionExpression") {
    if (body.type === "BlockStatement") {
      const ret = body.body?.find((s: any) => s.type === "ReturnStatement");
      returnExpr = ret?.argument ?? null;
    } else {
      returnExpr = body;
    }
  } else if (fn.type === "FunctionExpression" && body.type === "BlockStatement") {
    const ret = body.body?.find((s: any) => s.type === "ReturnStatement");
    returnExpr = ret?.argument ?? null;
  }
  if (!returnExpr) return null;

  // 剥掉 return ( ... ) 的外层括号，得到真正的 JSX 节点（防止死循环加次数上限）
  const maxUnwrap = 20;
  let unwraps = 0;
  while (returnExpr?.type === "ParenthesizedExpression" && unwraps < maxUnwrap) {
    returnExpr = returnExpr.expression;
    unwraps++;
  }
  return returnExpr?.type === "JSXElement" ? returnExpr : null;
}

/**
 * 从 return 表达式中取「第一个会渲染成 DOM 的 JSX 节点」。
 * 若 return 是 Fragment（<>...</>），Fragment 本身不渲染，取第一个子元素；子元素若仍是 Fragment 则递归。
 * 用于 pageRef：根为 Fragment 时仍能标记出第一个实际根节点，从而正确写入 data-zone-type='page'。
 */
function getFirstRenderedJSXElement(returnExpr: any): any {
  if (!returnExpr) return null;
  if (returnExpr.type === "JSXElement") return returnExpr;
  if (returnExpr.type === "JSXFragment") {
    const first = returnExpr.children?.[0];
    if (!first) return null;
    if (first.type === "JSXElement") return first;
    if (first.type === "JSXFragment") return getFirstRenderedJSXElement(first);
    return null;
  }
  return null;
}

/**
 * 与 getComponentRootJSXNode 类似，但 pageRef 允许根为 Fragment，此时返回 Fragment 的第一个子元素作为「逻辑根」。
 */
function getPageRootJSXNode(componentPath: any): any {
  const call = getRefCallFromComponentPath(componentPath, "pageRef");
  if (!call) return null;
  const fn = call.arguments[0];
  const body = fn?.body;
  if (!body) return null;

  let returnExpr: any = null;
  if (fn.type === "ArrowFunctionExpression") {
    if (body.type === "BlockStatement") {
      const ret = body.body?.find((s: any) => s.type === "ReturnStatement");
      returnExpr = ret?.argument ?? null;
    } else {
      returnExpr = body;
    }
  } else if (fn.type === "FunctionExpression" && body.type === "BlockStatement") {
    const ret = body.body?.find((s: any) => s.type === "ReturnStatement");
    returnExpr = ret?.argument ?? null;
  }
  if (!returnExpr) return null;

  const maxUnwrap = 20;
  let unwraps = 0;
  while (returnExpr?.type === "ParenthesizedExpression" && unwraps < maxUnwrap) {
    returnExpr = returnExpr.expression;
    unwraps++;
  }
  return getFirstRenderedJSXElement(returnExpr);
}

/**
 * 判断当前「调用」的 callee 是不是 comRef。
 * - comRef(...)           → Identifier，name === 'comRef'
 * - something.comRef(...) → MemberExpression，property.name === 'comRef'
 */
export function isComRefCall(callee: any): boolean {
  if (types.isIdentifier(callee)) return callee.name === "comRef";
  return callee?.property?.name === "comRef";
}

/**
 * 判断当前「调用」的 callee 是不是 pageRef。
 */
export function isPageRefCall(callee: any): boolean {
  if (types.isIdentifier(callee)) return callee.name === "pageRef";
  return callee?.property?.name === "pageRef";
}

/**
 * 判断当前「调用」的 callee 是不是 popupRef
 */
export function isPopupRefCall(callee: any): boolean {
  if (types.isIdentifier(callee)) return callee.name === "popupRef";
  return callee?.property?.name === "popupRef";
}

/**
 * 判断当前「调用」的 callee 是不是 appRef。
 */
export function isAppRefCall(callee: any): boolean {
  if (types.isIdentifier(callee)) return callee.name === "appRef";
  return callee?.property?.name === "appRef";
}

export type RefKind = 'comRef' | 'popupRef' | 'appRef';

export type RefNodeInfo = {
  /** 组件变量名。VariableDeclarator 取变量名；ExportDefaultDeclaration 取 fallbackName 或 'default'（appRef） */
  name: string;
  kind: RefKind;
};

/**
 * 从 VariableDeclarator AST 节点中提取 ref 信息。
 * 匹配：const Xxx = comRef(...) / popupRef(...)
 * 不匹配：appRef（appRef 只用 export default）
 *
 * @returns RefNodeInfo | null
 */
export function extractRefFromVariableDeclarator(node: any): RefNodeInfo | null {
  if (!node || node.type !== 'VariableDeclarator') return null;
  const { id, init } = node;
  if (!id || id.type !== 'Identifier') return null;
  if (!init || init.type !== 'CallExpression') return null;

  const { callee } = init;
  const varName = id.name as string;

  if (isComRefCall(callee)) return { name: varName, kind: 'comRef' };
  if (isPopupRefCall(callee)) return { name: varName, kind: 'popupRef' };
  return null;
}

/**
 * 从 ExportDefaultDeclaration AST 节点中提取 ref 信息。
 * 匹配：export default appRef(...) / comRef(...) / popupRef(...)
 *
 * @param node         ExportDefaultDeclaration 节点
 * @param fallbackName 文件路径派生的组件名，用于 comRef/popupRef 的 export default 场景
 * @returns RefNodeInfo | null
 */
export function extractRefFromExportDefault(node: any, fallbackName: string): RefNodeInfo | null {
  if (!node || node.type !== 'ExportDefaultDeclaration') return null;
  const decl = node.declaration;
  if (!decl || decl.type !== 'CallExpression') return null;

  const { callee } = decl;
  if (isAppRefCall(callee)) return { name: 'default', kind: 'appRef' };
  if (isComRefCall(callee)) return { name: fallbackName, kind: 'comRef' };
  if (isPopupRefCall(callee)) return { name: fallbackName, kind: 'popupRef' };
  return null;
}

/**
 * 对「当前这个 JSX 元素」判断：它是不是某个 comRef 组件的根节点？如果是，返回该组件 JSDoc（summary、props）；否则返回 null。
 *
 * 流程：
 * 1. 从当前 JSX 的 path 向上找「组件定义」：要么是 const X = comRef(...)，要么是 export default comRef(...)。
 * 2. 用缓存：同一个组件只算一次「根节点 + 解析 JSDoc」，避免每个子节点都重复算。
 * 3. 若当前节点不是该组件的根节点（rootJSX），直接返回 null，不挂 JSDoc。
 * 4. 若是根节点，从组件定义前的注释里解析出 @summary 和 @prop，返回给调用方（用于写入 data-loc）。
 */
export function getComRefForJSXPath(
  jsxPath: any,
  cache: Map<any, any>,
  fallbackName?: string
): any | null {
  // 向上找「包裹当前 JSX 的」comRef 组件定义（只认这两种写法）
  const componentPath = jsxPath.findParent((p: any) => {
    if (p.isVariableDeclarator()) {
      const init = p.node.init;
      return init && init.type === "CallExpression" && isComRefCall(init.callee);
    }
    if (p.isExportDefaultDeclaration()) {
      const decl = p.node.declaration;
      return decl && decl.type === "CallExpression" && isComRefCall(decl.callee);
    }
    return false;
  });
  if (!componentPath) return null;

  // 按组件声明做缓存：每个组件只算一次根节点 + 只解析一次 JSDoc
  let cached = cache.get(componentPath.node);
  if (cached === undefined) {
    cached = {};
    const rootJSX = getComponentRootJSXNode(componentPath, "comRef");
    let jsdoc: ReturnType<typeof parseJSDocComment> = null;
    if (rootJSX) {
      const node = componentPath.node;
      // JSDoc 在 Babel 里会挂在「语句」的 leadingComments 上：export default 挂在自身，const 挂在父级 VariableDeclaration
      const comments =
        node.type === "ExportDefaultDeclaration"
          ? node.leadingComments
          : (componentPath.parentPath?.node?.leadingComments ?? node.leadingComments);
      cached.name = node.type === "ExportDefaultDeclaration" ? (fallbackName ?? 'root') : node.id.name;
      if (Array.isArray(comments) && comments.length > 0) {
        const block = comments.find((c: any) => c.type === "CommentBlock");
        if (block && typeof block.value === "string") jsdoc = parseJSDocComment(block.value);
      }
    }
    cached.rootJSX = rootJSX;
    cached.jsdoc = jsdoc;
    cache.set(componentPath.node, cached);
  }

  // 只有「当前节点就是该组件的根节点」时才返回 JSDoc，否则不挂
  if (cached.rootJSX !== jsxPath.node) return null;
  return cached;
}

/**
 * 对「当前这个 JSX 元素」判断：它是不是某个 pageRef 页面的根节点？
 * 若是则返回 { name, jsdoc, rootJSX }，用于写入 data-zone-type='page' 与 data-zone-title（页面 title）。
 */
export function getPageRefForJSXPath(
  jsxPath: any,
  cache: Map<any, any>,
  fallbackName?: string
): any | null {
  const componentPath = jsxPath.findParent((p: any) => {
    if (p.isVariableDeclarator()) {
      const init = p.node.init;
      return init && init.type === "CallExpression" && isPageRefCall(init.callee);
    }
    if (p.isExportDefaultDeclaration()) {
      const decl = p.node.declaration;
      return decl && decl.type === "CallExpression" && isPageRefCall(decl.callee);
    }
    return false;
  });
  if (!componentPath) return null;

  let cached = cache.get(componentPath.node);
  if (cached === undefined) {
    cached = {};
    const rootJSX = getPageRootJSXNode(componentPath);
    let jsdoc: ReturnType<typeof parseJSDocComment> = null;
    if (rootJSX) {
      const node = componentPath.node;
      const comments =
        node.type === "ExportDefaultDeclaration"
          ? node.leadingComments
          : (componentPath.parentPath?.node?.leadingComments ?? node.leadingComments);
      cached.name = node.type === "ExportDefaultDeclaration" ? (fallbackName ?? 'root') : node.id.name;
      if (Array.isArray(comments) && comments.length > 0) {
        const block = comments.find((c: any) => c.type === "CommentBlock");
        if (block && typeof block.value === "string") jsdoc = parseJSDocComment(block.value);
      }
    }
    cached.rootJSX = rootJSX;
    cached.jsdoc = jsdoc;
    cache.set(componentPath.node, cached);
  }

  if (cached.rootJSX !== jsxPath.node) return null;
  return cached;
}

/**
 * 对「当前这个 JSX 元素」判断：它是不是某个 popupRef 弹窗的根节点？
 * 若是则返回 { name, jsdoc, rootJSX }，用于写入 data-zone-type='page' 与 data-zone-title（页面 title）。
 */
export function getPopupRefForJSXPath(
  jsxPath: any,
  cache: Map<any, any>,
  fallbackName?: string
): any | null {
  const componentPath = jsxPath.findParent((p: any) => {
    if (p.isVariableDeclarator()) {
      const init = p.node.init;
      return init && init.type === "CallExpression" && isPopupRefCall(init.callee);
    }
    if (p.isExportDefaultDeclaration()) {
      const decl = p.node.declaration;
      return decl && decl.type === "CallExpression" && isPopupRefCall(decl.callee);
    }
    return false;
  });
  if (!componentPath) return null;

  let cached = cache.get(componentPath.node);
  if (cached === undefined) {
    cached = {};
    const rootJSX = getDialogRootJSXNode(componentPath);
    let jsdoc: ReturnType<typeof parseJSDocComment> = null;
    if (rootJSX) {
      const node = componentPath.node;
      const comments =
        node.type === "ExportDefaultDeclaration"
          ? node.leadingComments
          : (componentPath.parentPath?.node?.leadingComments ?? node.leadingComments);
      cached.name = node.type === "ExportDefaultDeclaration" ? (fallbackName ?? 'root') : node.id.name;
      if (Array.isArray(comments) && comments.length > 0) {
        const block = comments.find((c: any) => c.type === "CommentBlock");
        if (block && typeof block.value === "string") jsdoc = parseJSDocComment(block.value);
      }
    }
    cached.rootJSX = rootJSX;
    cached.jsdoc = jsdoc;
    cache.set(componentPath.node, cached);
  }

  if (cached.rootJSX !== jsxPath.node) return null;
  return cached;
}

/**
 * 与 getComponentRootJSXNode 类似，但 popupRef 允许根为 Fragment，此时返回 Fragment 的第一个子元素作为「逻辑根」。
 */
function getDialogRootJSXNode(componentPath: any): any {
  const call = getRefCallFromComponentPath(componentPath, "popupRef");
  if (!call) return null;
  const fn = call.arguments[0];
  const body = fn?.body;
  if (!body) return null;

  let returnExpr: any = null;
  if (fn.type === "ArrowFunctionExpression") {
    if (body.type === "BlockStatement") {
      const ret = body.body?.find((s: any) => s.type === "ReturnStatement");
      returnExpr = ret?.argument ?? null;
    } else {
      returnExpr = body;
    }
  } else if (fn.type === "FunctionExpression" && body.type === "BlockStatement") {
    const ret = body.body?.find((s: any) => s.type === "ReturnStatement");
    returnExpr = ret?.argument ?? null;
  }
  if (!returnExpr) return null;

  const maxUnwrap = 20;
  let unwraps = 0;
  while (returnExpr?.type === "ParenthesizedExpression" && unwraps < maxUnwrap) {
    returnExpr = returnExpr.expression;
    unwraps++;
  }
  return getFirstRenderedJSXElement(returnExpr);
}