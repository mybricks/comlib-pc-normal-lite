export interface CssClassName {
  name: string;
  /** 是否来自条件表达式（ConditionalExpression 的分支 或 LogicalExpression 的 right） */
  conditional: boolean;
}

/** 将空格分隔的 class 字符串拆成 CssClassName[] */
function splitClassNames(value: string, isConditional: boolean): CssClassName[] {
  if (!value) return [];
  return value
    .split(/\s+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, conditional: isConditional }));
}

/**
 * 从 className 表达式中提取 class 名，并标记是否为条件性 class。
 *
 * 支持：
 * - CSS Module 成员访问：`styles.button` / `css.button` / `styles['button']`
 * - 字符串字面量：`"foo bar"` / `'foo'`（html-to-appref 等全局 class 场景）
 * - 模板字符串（含静态段与表达式插值）
 * - 条件 / 逻辑表达式等
 *
 * @param node          - AST 节点
 * @param isConditional - 当前节点是否处于条件分支上下文中（由父节点递归传入）
 * @param cssModuleNames - CSS module 导入变量名集合；若为空则接受任意 Identifier.xxx 访问
 */
export function extractCssClassNames(node: any, isConditional = false, cssModuleNames?: Set<string>): CssClassName[] {
  const result: CssClassName[] = [];
  if (!node) return result;

  // className="foo bar" 经 JSXExpressionContainer 包一层后的字符串，或 className={"foo"}
  if (node.type === "StringLiteral") {
    return splitClassNames(node.value || "", isConditional);
  }

  // 部分解析器会把 JSX 属性字符串标成 Literal
  if (node.type === "Literal" && typeof node.value === "string") {
    return splitClassNames(node.value, isConditional);
  }

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
    // 静态段：`foo ${x} bar` 中的 "foo " / " bar"
    for (const quasi of node.quasis || []) {
      const cooked = quasi.value?.cooked ?? quasi.value?.raw ?? "";
      result.push(...splitClassNames(cooked, isConditional));
    }
    // 插值表达式：css.xxx / 条件表达式等
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
 * 从 JSXElement 的 className 属性提取 class 列表。
 * 同时支持：
 * - className="foo bar"（属性值为 StringLiteral）
 * - className={css.foo} / className={`a ${css.b}`}（JSXExpressionContainer）
 */
export function extractCssClassNamesFromJSXElement(
  node: any,
  cssModuleNames?: Set<string>,
): CssClassName[] {
  if (!node || node.type !== "JSXElement") return [];
  const classNameAttr = node.openingElement?.attributes?.find(
    (a: any) => a.name?.name === "className",
  );
  if (!classNameAttr?.value) return [];

  const value = classNameAttr.value;
  if (value.type === "StringLiteral" || (value.type === "Literal" && typeof value.value === "string")) {
    return extractCssClassNames(value, false, cssModuleNames);
  }
  if (value.type === "JSXExpressionContainer") {
    return extractCssClassNames(value.expression, false, cssModuleNames);
  }
  return [];
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

  const raw = extractCssClassNamesFromJSXElement(node, cssModuleNames);

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
  const maxJsxDepth = 5;
  let segments: string[] = [];
  let p: any = path;
  let jsxDepth = 0;
  while (p?.node && jsxDepth < maxJsxDepth) {
    if (p.isJSXElement?.()) {
      const selectors = getSelectorSegment(p.node, importRelyMap, cssModuleNames);
      if (selectors.length === 1) {
        segments =
          segments.length === 0
            ? [selectors[0]]
            : segments.map((segment) => `${selectors[0]} ${segment}`);
        jsxDepth += 1;
      } else if (selectors.length > 1) {
        // 多个选择器时分支：当前层（祖先）在前，已有 segment（后代）在后
        segments =
          segments.length === 0
            ? [...selectors]
            : segments.flatMap((segment) => selectors.map((sel) => `${sel} ${segment}`));
        jsxDepth += 1;
      }
    };
    p = p.parentPath;
  }
  return segments;
}
