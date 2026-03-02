import { findRelyAndSource } from "./rely";

/**
 * 从 className 表达式中提取所有 css.xxx 的 xxx 值
 * 支持：css.button、`${css.button} ${css.submit}`、条件表达式中的 css.disabled 等
 */
export function extractCssClassNames(node: any): string[] {
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

/**
 * 从单个 JSX 元素节点得到「选择器片段」，如 "div.container" 或 "h1"
 */
export function getSelectorSegment(node: any, importRelyMap: any) {
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
export function getCssSelectorForJSXPath(path: { node: any; parentPath?: any }, importRelyMap: any) {
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