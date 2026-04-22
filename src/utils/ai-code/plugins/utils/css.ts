import { findRelyAndSource, getJSXElementNameString } from "./rely";

export interface CssClassName {
  name: string;
  /** 是否来自条件表达式（ConditionalExpression 的分支 或 LogicalExpression 的 right） */
  conditional: boolean;
}

/**
 * 从 className 表达式中提取所有 styles.xxx / css.xxx 等 CSS Module 成员访问，并标记是否为条件性 class。
 * 支持任意导入别名，如 `import styles from './index.less'` 后使用 `styles.button`、
 * `import css from './style.less'` 后使用 `css.button`，以及模板字符串、条件表达式等。
 *
 * @param node          - AST 节点
 * @param isConditional - 当前节点是否处于条件分支上下文中（由父节点递归传入）
 * @param cssModuleNames - CSS module 导入变量名集合；若为空则接受任意 Identifier.xxx 访问
 */
export function extractCssClassNames(node: any, isConditional = false, cssModuleNames?: Set<string>): CssClassName[] {
  const result: CssClassName[] = [];
  if (!node) return result;

  if (node.type === "MemberExpression") {
    const obj = node.object;
    const prop = node.property;
    // 接受任意 Identifier 对象（如 css.xxx / styles.xxx / s.xxx）
    // 若提供了 cssModuleNames，则仅匹配已知的 CSS module 导入变量名
    if (obj?.type === "Identifier" && (!cssModuleNames || cssModuleNames.has(obj.name))) {
      // styles.classname
      if (prop?.type === "Identifier") {
        result.push({ name: prop.name, conditional: isConditional });
      }
      // styles['classname']
      if (node.computed && prop?.type === "StringLiteral") {
        result.push({ name: prop.value, conditional: isConditional });
      }
    }
    return result;
  }

  if (node.type === "BinaryExpression" && node.operator === "+") {
    result.push(...extractCssClassNames(node.left, isConditional, cssModuleNames));
    result.push(...extractCssClassNames(node.right, isConditional, cssModuleNames));
    return result;
  }

  if (node.type === "TemplateLiteral") {
    // 模板字符串本身不改变 conditional 语义，透传父级的 isConditional
    for (const expr of node.expressions || []) {
      result.push(...extractCssClassNames(expr, isConditional, cssModuleNames));
    }
    return result;
  }

  if (node.type === "ConditionalExpression") {
    // consequent / alternate 都是条件性的，无论父级是否已经是条件分支
    result.push(...extractCssClassNames(node.consequent, true, cssModuleNames));
    result.push(...extractCssClassNames(node.alternate, true, cssModuleNames));
    return result;
  }

  if (node.type === "LogicalExpression") {
    // left 通常是布尔判断（如 isActive），不含 css.xxx，透传父级 isConditional
    result.push(...extractCssClassNames(node.left, isConditional, cssModuleNames));
    // right 只在条件成立时生效，标记为 conditional
    result.push(...extractCssClassNames(node.right, true, cssModuleNames));
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
export function getSelectorSegment(node: any, importRelyMap: any, cssModuleNames?: Set<string>): string[] {
  if (!node || node.type !== "JSXElement") return [];
  const classNameAttr = node.openingElement.attributes.find((a) => a.name?.name === "className");
  const classNameExpr = classNameAttr?.value?.type === "JSXExpressionContainer" ? classNameAttr.value.expression : null;

  const raw = extractCssClassNames(classNameExpr, false, cssModuleNames);

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

  return [];

  // const tagName = getJSXElementNameString(node.openingElement.name);

  // if (!tagName) {
  //   return [];
  // }

  // const { relyName, source } = findRelyAndSource(tagName.split(".")[0], importRelyMap);

  // if (source === "html") {
  //   return [relyName]
  // }
  // return [];
}

/**
 * 在 AST 访问阶段，根据当前 JSX 的 path 向上收集祖先，拼出完整 CSS 选择器。
 * 例如根节点 <div className={css.container}> 得到 "div.container"，
 * 其子 &lt;h1&gt; 得到 "div.container > h1"。
 */
export function getCssSelectorForJSXPath(path: { node: any; parentPath?: any }, importRelyMap: any, cssModuleNames?: Set<string>) {
  let segments: string[] = [];
  let p: any = path;
  while (p?.node) {
    if (p.isJSXElement?.()) {
      const selectors = getSelectorSegment(p.node, importRelyMap, cssModuleNames);
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