import { findRelyAndSource, getJSXElementNameString } from "./rely";

export interface CssClassName {
  name: string;
  /** 是否来自条件表达式（ConditionalExpression 的分支 或 LogicalExpression 的 right） */
  conditional: boolean;
}

/**
 * 从 className 表达式中提取所有 css.xxx，并标记是否为条件性 class。
 * 支持：css.button、`${css.button} ${css.submit}`、条件表达式中的 css.disabled 等
 *
 * @param node          - AST 节点
 * @param isConditional - 当前节点是否处于条件分支上下文中（由父节点递归传入）
 */
export function extractCssClassNames(node: any, isConditional = false): CssClassName[] {
  const result: CssClassName[] = [];
  if (!node) return result;

  if (node.type === "MemberExpression") {
    const obj = node.object;
    const prop = node.property;
    if (obj?.type === "Identifier" && obj.name === "css" && prop?.type === "Identifier") {
      result.push({ name: prop.name, conditional: isConditional });
    }
    return result;
  }

  if (node.type === "TemplateLiteral") {
    // 模板字符串本身不改变 conditional 语义，透传父级的 isConditional
    for (const expr of node.expressions || []) {
      result.push(...extractCssClassNames(expr, isConditional));
    }
    return result;
  }

  if (node.type === "ConditionalExpression") {
    // consequent / alternate 都是条件性的，无论父级是否已经是条件分支
    result.push(...extractCssClassNames(node.consequent, true));
    result.push(...extractCssClassNames(node.alternate, true));
    return result;
  }

  if (node.type === "LogicalExpression") {
    // left 通常是布尔判断（如 isActive），不含 css.xxx，透传父级 isConditional
    result.push(...extractCssClassNames(node.left, isConditional));
    // right 只在条件成立时生效，标记为 conditional
    result.push(...extractCssClassNames(node.right, true));
    return result;
  }

  return result;
}

/**
 * 从单个 JSX 元素节点得到「选择器片段」列表。
 *
 * 处理规则：
 * - 非条件 class（base）各自独立输出，如 [".actionBtn", ".primary"]
 * - 条件 class 与每个 base class 组合成复合选择器，如 ".navItem.active"
 *   这样 ".navItem.active" 才能精确匹配"同时具有两个 class 的元素"，
 *   而不是裸的 ".active" 误匹配任意元素
 * - 若无 base class，条件 class 退化为独立输出（向后兼容）
 */
export function getSelectorSegment(node: any, importRelyMap: any): string[] {
  if (!node || node.type !== "JSXElement") return [];
  const classNameAttr = node.openingElement.attributes.find((a) => a.name?.name === "className");
  const classNameExpr = classNameAttr?.value?.type === "JSXExpressionContainer" ? classNameAttr.value.expression : null;

  const raw = extractCssClassNames(classNameExpr);

  // 按 name 去重，保留第一次出现的条目
  const seen = new Set<string>();
  const cnList = raw.filter(item => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });

  if (cnList.length) {
    const baseClasses = cnList.filter(c => !c.conditional);
    const conditionalClasses = cnList.filter(c => c.conditional);

    const result: string[] = baseClasses.map(c => `.${c.name}`);

    if (conditionalClasses.length > 0) {
      if (baseClasses.length > 0) {
        // 每个条件 class 与每个 base class 组合成复合选择器（无空格）
        // 例：base=".navItem"，conditional="active" → ".navItem.active"
        for (const cond of conditionalClasses) {
          for (const base of baseClasses) {
            result.push(`.${base.name}.${cond.name}`);
          }
        }
      } else {
        // 没有 base class 时，条件 class 退化为独立路径
        for (const cond of conditionalClasses) {
          result.push(`.${cond.name}`);
        }
      }
    }

    return result;
  }

  const tagName = getJSXElementNameString(node.openingElement.name);

  if (!tagName) {
    return [];
  }

  const { relyName, source } = findRelyAndSource(tagName.split(".")[0], importRelyMap);

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