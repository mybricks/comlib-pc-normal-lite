import * as types from "../types";
import { parseJSDocComment } from "./jsdoc";


/**
 * 从「组件定义」AST 节点上，取出 comRef(...) 对应的调用节点（CallExpression）。
 *
 * 为什么需要：组件有两种写法，AST 结构不同，但都要拿到「comRef 的调用」才能继续找函数体、return、根 JSX。
 * - const MainBtn = comRef(() => {...})  → 调用在 VariableDeclarator.init 上
 * - export default comRef(() => {...})   → 调用在 ExportDefaultDeclaration.declaration 上
 */
function getComRefCallFromComponentPath(componentPath: any): any {
  const node = componentPath.node;
  if (node.type === "VariableDeclarator") return node.init;
  if (node.type === "ExportDefaultDeclaration") return node.declaration;
  return null;
}

/**
 * 拿到「组件根节点」：即 comRef 里那个函数 return 出来的「最外层一个 JSX 元素」。
 *
 * 用途：只有这个根节点会挂 JSDoc（summary、props），子节点不挂，所以要先算出根是谁。
 *
 * 步骤简述：
 * 1. 从组件定义拿到 comRef(...) 的调用，再取第一个参数（箭头函数/普通函数）
 * 2. 从函数体里找到 return 的表达式（有花括号时找 ReturnStatement.argument，否则箭头函数体就是 return 值）
 * 3. 剥掉外层括号：return ( <div> ) 在 AST 里是 ParenthesizedExpression，要取 .expression 直到得到 JSXElement
 * 4. 只有最外层是「单个 JSX 元素」才返回；如果是 Fragment（<>...</>）或别的类型就返回 null
 */
function getComponentRootJSXNode(componentPath: any): any {
  const call = getComRefCallFromComponentPath(componentPath);
  if (!call || call.type !== "CallExpression" || !call.arguments?.[0]) return null;
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
 * 判断当前「调用」的 callee 是不是 comRef。
 * - comRef(...)           → Identifier，name === 'comRef'
 * - something.comRef(...) → MemberExpression，property.name === 'comRef'
 */
function isComRefCall(callee: any): boolean {
  if (types.isIdentifier(callee)) return callee.name === "comRef";
  if (callee?.type === "MemberExpression" && callee.property?.type === "Identifier")
    return callee.property.name === "comRef";
  return false;
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
  cache: Map<any, any>
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
    const rootJSX = getComponentRootJSXNode(componentPath);
    let jsdoc: ReturnType<typeof parseJSDocComment> = null;
    if (rootJSX) {
      const node = componentPath.node;
      // JSDoc 在 Babel 里会挂在「语句」的 leadingComments 上：export default 挂在自身，const 挂在父级 VariableDeclaration
      const comments =
        node.type === "ExportDefaultDeclaration"
          ? node.leadingComments
          : (componentPath.parentPath?.node?.leadingComments ?? node.leadingComments);
      cached.name = node.type === "ExportDefaultDeclaration" ? "root" : node.id.name;
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
