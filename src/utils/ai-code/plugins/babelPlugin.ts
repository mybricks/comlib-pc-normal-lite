import * as types from "./types";
import { getMapCallbackIndexParam, pushDataAttr, pushDataAttrExpression } from "./utils";

/**
 * 从单个 JSX 元素节点得到「选择器片段」，如 "div.container" 或 "h1"
 */
function getSelectorSegment(node: any, importRelyMap: any) {
  if (!node || node.type !== "JSXElement") return [];
  const classNameAttr = node.openingElement.attributes.find((a) => a.name?.name === "className");
  const classNameExpr = classNameAttr?.value?.type === "JSXExpressionContainer" ? classNameAttr.value.expression : null;
  const cnList = [...new Set(extractCssClassNames(classNameExpr))];
  if (cnList.length) {
    return cnList.map((c) => "." + c);
  }

  const { relyName, source } = findRelyAndSource(node.openingElement.name.name, importRelyMap);

  if (source === "html") {
    return [relyName]
  }
  return [];
}

/**
 * 在 AST 访问阶段，根据当前 JSX 的 path 向上收集祖先，拼出完整 CSS 选择器。
 * 例如根节点 <div className={css.container}> 得到 "div.container"，
 * 其子 &lt;h1&gt; 得到 "div.container > h1"。
 */
function getCssSelectorForJSXPath(path: { node: any; parentPath?: any }, importRelyMap: any) {
  let segments: string[] = [];
  let p: any = path;
  while (p?.node) {
    if (p.isJSXElement?.()) {
      const selectors = getSelectorSegment(p.node, importRelyMap);
      if (selectors.length === 1) {
        segments =
          segments.length === 0
            ? [selectors[0]]
            : segments.map((segment) => `${selectors[0]} ${segment}`);
      } else if (selectors.length > 1) {
        // 多个选择器时分支：当前层（祖先）在前，已有 segment（后代）在后
        segments =
          segments.length === 0
            ? [...selectors]
            : segments.flatMap((segment) => selectors.map((sel) => `${sel} ${segment}`));
      }
    };
    p = p.parentPath;
  }
  return segments;
}

export default function ({ constituency }) {
  return function () {
    const importRelyMap = new Map();
    /** 按组件声明缓存 { rootJSX, jsdoc }，每个 comRef 组件只计算一次 */
    const componentJsdocCache = new Map<any, any>();

    return {
      visitor: {
        ImportDeclaration(path) {
          try {
            const { node } = path;
            node.specifiers.forEach((specifier) => {
              if (types.isImportSpecifier(specifier)) {
                importRelyMap.set(specifier.local.name, node.source.value);
              }
            })
          } catch { }
        },
        VariableDeclarator(path) {
          try {
            const { id, init } = path.node;
            if (types.isIdentifier(id) && types.isMemberExpression(init)) {
              const name = path.node.id?.name;
              const relyName = path.node.init?.object?.loc?.identifierName;
              importRelyMap.set(name, relyName);
            }
          } catch { }
        },
        JSXElement(path) {
          try {
            const { node } = path;
            const dataLocValueObject: any = {
              jsx: { start: node.start, end: node.end },
              tag: { end: node.openingElement.end },
            };
            const classNameAttr = node.openingElement.attributes.find((a) => a.name?.name === "className");
            const classNameExpr = classNameAttr?.value?.type === "JSXExpressionContainer" ? classNameAttr.value.expression : null;
            const cnList = [...new Set(extractCssClassNames(classNameExpr))];

            const selectors = getCssSelectorForJSXPath(path, importRelyMap);
            pushDataAttr(node.openingElement.attributes, "data-zone-selector", JSON.stringify(selectors));

            if (cnList.length > 0) {
              dataLocValueObject.cn = cnList
              const { relyName, source } = findRelyAndSource(node.openingElement.name.name, importRelyMap);

              // 仅当当前 JSX 是「组件根节点」时挂 JSDoc（summary、@prop），并写入 data-loc，供聚焦时读取；按组件缓存避免重复计算
              // const jsdoc = getComRefForJSXPath(path, componentJsdocCache);
              // if (jsdoc) {
              //   dataLocValueObject.jsdoc = jsdoc;
              // }

              constituency.push({
                className: cnList,
                component: relyName,
                source,
                selectors,
                // ...(jsdoc && { jsdoc }),
              })

              // node.openingElement.attributes.push({
              //   type: 'JSXAttribute',
              //   name: {
              //     type: 'JSXIdentifier',
              //     name: 'data-cn',
              //   },
              //   value: {
              //     type: 'StringLiteral',
              //     value: cnList.join(' '),
              //     extra: {
              //       raw: `"${cnList.join(' ')}"`,
              //       rawValue: cnList.join(' ')
              //     }
              //   }
              // })

              const mapIndexParam = getMapCallbackIndexParam(path);
              if (mapIndexParam != null) {
                pushDataAttrExpression(node.openingElement.attributes, "data-map-index", mapIndexParam);
              }
            }

            let zoneType = "zone";

            const comRef = getComRefForJSXPath(path, componentJsdocCache);
            if (comRef) {
              zoneType = "com";
              pushDataAttr(node.openingElement.attributes, "data-jsdoc", JSON.stringify(comRef.jsdoc));
              pushDataAttr(node.openingElement.attributes, "data-com-name", comRef.name);
            }

            pushDataAttr(node.openingElement.attributes, "data-zone-type", zoneType);
            pushDataAttr(node.openingElement.attributes, "data-loc", JSON.stringify(dataLocValueObject));
          } catch { }
        },
        Program: {
          exit() {
            // 解析/遍历结束：整棵 AST 已访问完，importRecord 等已收集完毕
            // console.log("[@importRelyMap]", { importRelyMap })
          }
        }
      }
    };
  }
}

/**
 * 从 className 表达式中提取所有 css.xxx 的 xxx 值
 * 支持：css.button、`${css.button} ${css.submit}`、条件表达式中的 css.disabled 等
 */
function extractCssClassNames(node: any): string[] {
  const result: string[] = [];
  if (!node) return result;

  if (node.type === "MemberExpression") {
    const obj = node.object;
    const prop = node.property;
    if (obj?.type === "Identifier" && obj.name === "css" && prop?.type === "Identifier") {
      result.push(prop.name);
    }
    return result;
  }

  if (node.type === "TemplateLiteral") {
    for (const expr of node.expressions || []) {
      result.push(...extractCssClassNames(expr));
    }
    return result;
  }

  if (node.type === "ConditionalExpression") {
    result.push(...extractCssClassNames(node.consequent));
    result.push(...extractCssClassNames(node.alternate));
    return result;
  }

  if (node.type === "LogicalExpression") {
    result.push(...extractCssClassNames(node.left));
    result.push(...extractCssClassNames(node.right));
    return result;
  }

  return result;
}

function findRelyAndSource(relyName, importRelyMap) {
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
function getComRefForJSXPath(
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

/**
 * 把 JSDoc 注释的「原始字符串」解析成结构化数据：summary + props 数组 + events 数组。
 *
 * 入参 raw：Babel 里 CommentBlock 的 .value（块注释中间部分，每行可能带前导 " * "）。
 *
 * 支持的写法示例：
 *   @summary 主按钮
 *   @prop 加 type 时：{string} text - 按钮内容
 *   @param 加 type 时：{number} count - 数量（@param 与 @prop 都会收集到 props）
 *   @event：{事件key} 事件名 - 描述（如 Mermaid 流程图）
 *
 * 返回：{ summary?, props?, events? }；若既没有 summary 也没有任何 prop 也没有任何 event 则返回 null。
 */
function parseJSDocComment(raw: string): { summary?: string; props?: Array<{ type?: string; name: string; description?: string }>; events?: Array<{ key: string; name?: string; description?: string }> } | null {
  if (raw == null || typeof raw !== "string") return null;
  // 按行分割，并去掉每行前面的 " * " 或 "* "，方便后面用正则匹配
  const lines = raw.split(/\r?\n/).map((s) => s.replace(/^\s*\*\s?/, "").trim());
  let summary: string | undefined;
  const props: Array<{ type?: string; name: string; description?: string }> = [];
  const events: Array<{ key: string; name?: string; description?: string }> = [];

  for (const line of lines) {
    const summaryMatch = line.match(/^@summary\s+(.+)$/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      continue;
    }
    // @prop / @param：可选 {type}，必填 name，可选 "- 描述"
    const propMatch = line.match(/^@(?:prop|param)\s+(?:\{([^}]*)\}\s+)?(\S+)(?:\s+-\s+(.+))?$/);
    if (propMatch) {
      props.push({
        type: propMatch[1]?.trim() || undefined,
        name: propMatch[2].trim(),
        description: propMatch[3]?.trim() || undefined,
      });
      continue;
    }
    // @event：必填 {事件key}，事件名，可选 " - 描述"（与 @prop 处理方式一致）
    const eventMatch = line.match(/^@event\s+\{([^}]*)\}\s+(.+)$/);
    if (eventMatch) {
      const key = eventMatch[1].trim();
      const rest = eventMatch[2].trim();
      const dashIdx = rest.indexOf(" - ");
      const name = dashIdx >= 0 ? rest.slice(0, dashIdx).trim() : rest;
      const description = dashIdx >= 0 ? rest.slice(dashIdx + 3).trim() : undefined;
      events.push({ key, name: name || undefined, description });
    }
  }

  if (!summary && props.length === 0 && events.length === 0) return null;
  const result: any = { summary };
  if (props.length) {
    result.props = props;
  }
  if (events.length) {
    result.events = events;
  }
  return result;
}
