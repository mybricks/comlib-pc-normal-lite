import { convertHyphenToCamel, convertCamelToHyphen } from "../../../../utils/string";

interface Rule {
  selectors?: {
    toCSS: () => string;
  }[];
  type: "Ruleset" | "Declaration" | "Media" | "AtRule";
  rules: (RuleSet | Declaration | Media | AtRule)[];
}

interface RuleSet extends Rule {
  root: true;
  type: "Ruleset";
}

type Keyword = {
  toCSS: () => string;
}

type Anonymous = {
  type: "Anonymous";
  toCSS: () => string;
}

type Color = {
  type: "Color";
  toCSS: () => string;
}

type Dimension = {
  type: "Dimension";
  toCSS: () => string;
}

type Call = {
  type: "Call";
  toCSS: () => string;
}

type Paren = {
  type: "Paren";
  value: Declaration;
}

type Expression = {
  value: (Color | Dimension | Call | Paren)[];
}

type Value = {
  type: "Value";
  toCSS: () => string;
};

interface Declaration extends Rule {
  type: "Declaration";
  name: Keyword[] | string;
  value: Anonymous | Value;
  important: string;
}

interface Media extends Rule {
  type: "Media";
  features: {
    value: Expression[];
  };
}

interface AtRule extends Rule {
  type: "AtRule";
  name: string;
  value: Keyword;
}

type CSSObj = Record<string, any>;

/**
 * 深度合并两个 CSSObj，当相同 key 的值都是对象时递归合并，否则后者覆盖前者。
 * 用于处理同一选择器在 Less 源码中出现多次（如两个 .formSelect {}）的情况。
 */
const deepMerge = (target: CSSObj, source: CSSObj): CSSObj => {
  const result: CSSObj = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value === "object" &&
      value !== null &&
      typeof result[key] === "object" &&
      result[key] !== null
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
};

/**
 * 从原始 Less 代码中提取所有 :global(...) 表达式，替换为合法的占位符类名。
 * 使用括号计数器处理嵌套括号（如 :global(.a:not(.b))），跳过注释区域。
 *
 * 返回：
 *   sanitized  - 占位符替换后的 Less 代码，可直接送入 less.parse()
 *   globalMap  - 占位符 → 原始 :global() 内容的映射
 */
const extractGlobals = (code: string): { sanitized: string; globalMap: Map<string, string> } => {
  const globalMap = new Map<string, string>();

  // 生成在当前 code 中不存在的唯一短前缀（纯小写字母，避免 Less 对特殊字符的处理干扰）
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let prefix = "";
  for (let k = 0; k < 6; k++) {
    prefix += chars[Math.floor(Math.random() * chars.length)];
  }
  // 确保前缀在原始代码中不存在，防止与真实类名冲突
  while (code.includes(prefix)) {
    prefix = "";
    for (let k = 0; k < 8; k++) {
      prefix += chars[Math.floor(Math.random() * chars.length)];
    }
  }

  let result = "";
  let i = 0;
  let counter = 0;

  // 将计数器转为字母序列（a, b, ..., z, aa, ab, ...），确保占位符全为字母，不含数字
  const toLetters = (n: number): string => {
    let s = "";
    do {
      s = chars[n % 26] + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  };

  while (i < code.length) {
    // 跳过块注释 /* ... */
    if (code[i] === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end === -1) {
        result += code.slice(i);
        break;
      }
      result += code.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    // 跳过行注释 // ...
    if (code[i] === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i + 2);
      if (end === -1) {
        result += code.slice(i);
        break;
      }
      result += code.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    // 匹配 :global(
    if (code.slice(i, i + 8) === ":global(") {
      // 用括号计数器找到配对的 )
      let depth = 1;
      let j = i + 8;
      while (j < code.length && depth > 0) {
        if (code[j] === "(") depth++;
        else if (code[j] === ")") depth--;
        j++;
      }
      // j 现在指向配对 ) 的下一位
      const innerContent = code.slice(i + 8, j - 1); // :global() 括号内的内容
      const placeholder = `${prefix}${toLetters(counter++)}`;
      globalMap.set(placeholder, innerContent.trim());
      result += `.${placeholder}`;
      i = j;
      continue;
    }

    result += code[i];
    i++;
  }

  return { sanitized: result, globalMap };
};

/**
 * 将 cssObj 所有层级的 key 中的占位符还原为完整的 :global(...) 表达式。
 * 深度递归处理，兼容 @media 嵌套结构。
 */
const restoreGlobals = (cssObj: CSSObj, globalMap: Map<string, string>): CSSObj => {
  if (globalMap.size === 0) return cssObj;

  const restoreKey = (key: string): string => {
    let result = key;
    globalMap.forEach((original, placeholder) => {
      result = result.split(`.${placeholder}`).join(`:global(${original})`);
    });
    return result.replace(/\s+/g, " ").trim();
  };

  const walk = (obj: CSSObj): CSSObj => {
    const result: CSSObj = {};
    for (const [key, value] of Object.entries(obj)) {
      const restoredKey = restoreKey(key);
      result[restoredKey] = typeof value === "object" && value !== null ? walk(value) : value;
    }
    return result;
  };

  return walk(cssObj);
};

/**
 * 从 Less AST 节点中获取选择器字符串，保留 & 前缀。
 * Less 的 toCSS() 会输出带前导空格的形式如 " &:hover"，需要去掉前导空格。
 */
const getRawSelector = (selectors: Rule["selectors"]): string => {
  if (!selectors || selectors.length === 0) return "";
  const parts = selectors.map(s => s.toCSS().trim());
  return parts.join(", ");
};

/**
 * 检测 Less AST 子树中是否含有 Variable 节点（@xxx 引用）。
 * 用于在调用 toCSS() 前快速判断是否需要走 AST 遍历路径。
 */
function hasVariableNode(node: any): boolean {
  if (!node) return false;
  if ((node.type ?? node.constructor?.name) === 'Variable') return true;
  if (Array.isArray(node.value))    return node.value.some((c: any) => hasVariableNode(c));
  if (Array.isArray(node.args))     return node.args.some((a: any) => hasVariableNode(a));
  if (Array.isArray(node.operands)) return node.operands.some((o: any) => hasVariableNode(o));
  return false;
}

/**
 * 递归提取 Less AST 节点的原始文本表示，保留变量引用（@xxx）不求值。
 * Variable 节点直接返回 node.name，其余节点降级调用 toCSS()。
 */
function extractRawLessValue(node: any): string {
  if (!node) return '';
  const type = node.type ?? node.constructor?.name;

  if (type === 'Variable') return String(node.name ?? '');

  if (type === 'Value' && Array.isArray(node.value))
    return node.value.map((c: any) => extractRawLessValue(c)).join(', ');

  if (type === 'Expression' && Array.isArray(node.value))
    return node.value.map((c: any) => extractRawLessValue(c)).join(' ');

  if (type === 'Call' && node.name) {
    const args = Array.isArray(node.args)
      ? node.args.map((a: any) => extractRawLessValue(a)).join(', ')
      : '';
    return `${node.name}(${args})`;
  }

  if (type === 'Operation' && node.op != null && Array.isArray(node.operands)) {
    const l = extractRawLessValue(node.operands[0]);
    const r = extractRawLessValue(node.operands[1]);
    return `${l} ${node.op} ${r}`;
  }

  if (typeof node.toCSS === 'function') {
    try { const v = node.toCSS(); if (v) return String(v); } catch {}
  }
  if (typeof node.value === 'string') return node.value;
  return '';
}

class Parse {

  cssObj: CSSObj = {};

  constructor(private _ruleSet: RuleSet) {
    const res = this.handleRuleSet(this._ruleSet);
    res.forEach(({key, value}) => {
      if (this.cssObj[key] && typeof this.cssObj[key] === 'object' && typeof value === 'object') {
        this.cssObj[key] = deepMerge(this.cssObj[key], value)
      } else {
        this.cssObj[key] = value
      }
    })
  }

  get() {
    return this.cssObj;
  }

  handleRules(rules: Rule["rules"]) {
    const cssObj: CSSObj = {};
    const cssObjs: {key: string, value: CSSObj}[] = [];
    rules.forEach((rule) => {
      if (rule.type === "Ruleset") {
        const next = this.handleRuleSet(rule);
        cssObjs.push(...next)
      } else if (rule.type === "Declaration") {
        const res = this.handleDeclaration(rule);
        cssObj[res.key] = res.value;
      } else if (rule.type === "Media") {
        const res = this.handleMedia(rule);
        cssObjs.push(res);
      } else if (rule.type === "AtRule") {
        const res = this.handleAtRule(rule);
        cssObjs.push(res);
      } else {
        // @ts-ignore
        // console.log("其它 => ", rule.type);
      }
    })

    return {
      cssObj,
      cssObjs
    }
  }

  handleRuleSet(ruleSet: RuleSet): {key: string, value: CSSObj}[] {
    // 使用 getRawSelector 保留 & 前缀，不像 getSelector 那样 slice(1)
    const selector = ruleSet.root ? "" : getRawSelector(ruleSet.selectors);
    const res: {key: string, value: CSSObj}[] = [];
    const { cssObj, cssObjs } = this.handleRules(ruleSet.rules);

    if (selector) {
      // 将子规则（cssObjs）作为嵌套对象合并进当前节点的 value
      const nestedValue: CSSObj = { ...cssObj };
      cssObjs.forEach(({ key, value }) => {
        if (nestedValue[key] && typeof nestedValue[key] === 'object' && typeof value === 'object') {
          nestedValue[key] = deepMerge(nestedValue[key], value);
        } else {
          nestedValue[key] = value;
        }
      });
      res.push({
        key: selector,
        value: nestedValue
      });
      return res;
    }

    // root 节点：直接展开，但先把 cssObj 的属性作为一个匿名块放到前面
    if (Object.keys(cssObj).length > 0) {
      res.push({ key: "&", value: cssObj });
    }
    return res.concat(cssObjs);
  }

  handleDeclaration(declaration: Declaration) {
    let key = "";
    if (typeof declaration.name === "string") {
      key = declaration.name;
    } else {
      key = declaration.name[0].toCSS();
    }

    // 若值中含有 Less 变量引用（如 @canvas-soft），直接从 AST 读取原始文本，
    // 绕过 toCSS()——后者在无求值上下文时会将变量降级为空字符串。
    const valueNode = declaration.value as any;
    let rawValue: string;
    if (hasVariableNode(valueNode)) {
      rawValue = extractRawLessValue(valueNode);
    } else {
      try {
        rawValue = declaration.value.toCSS();
      } catch {
        rawValue = extractRawLessValue(valueNode);
      }
    }

    return {
      // Less 变量定义（@xxx: value）不做驼峰转换，保留原始名称
      key: key.startsWith('@') ? key : convertHyphenToCamel(key),
      value: rawValue + (declaration.important || ""),
    }
  }

  handleMedia(media: Media) {
    const features = media.features.value.reduce<string>((features, expression: Expression) => {
      expression.value.forEach((value) => {
        if (value.type === "Paren") {
          const res = this.handleDeclaration(value.value);
          features += ` (${convertCamelToHyphen(res.key)}: ${res.value})`;
        } else {
          features += ` ${value.toCSS()}`;
        }
      })
      return features;
    }, "@media");
    const { cssObj, cssObjs } = this.handleRules(media.rules);

    const value: CSSObj = { ...cssObj };
    cssObjs.forEach(({ key: k, value: v }) => {
      value[k] = v;
    });

    return {
      key: features,
      value,
    }
  }

  handleAtRule(atRule: AtRule) {
    const name = atRule.name;
    const value = atRule.value.toCSS();
    const { cssObj, cssObjs } = this.handleRules(atRule.rules);

    const combined: CSSObj = { ...cssObj };
    cssObjs.forEach(({ key: k, value: v }) => {
      combined[k] = v;
    });

    return {
      key: `${name} ${value}`,
      value: combined,
    }
  }
}

export const parseLess = (code: string) => {
  const less = window.less;
  let cssObj: CSSObj = {};

  const { sanitized, globalMap } = extractGlobals(code);

  try {
    // 直接 parse Less 源码（不经过 render 编译），保留嵌套结构
    (less as any).parse(sanitized, (error: any, output: any) => {
      if (error) {
        // console.error(error);
      } else {
        const parse = new Parse(output);
        const rawObj = parse.get();
        // 将 & 隐式根属性展开
        const flatObj: CSSObj = {};
        Object.entries(rawObj).forEach(([key, value]) => {
          if (key === "&") {
            Object.assign(flatObj, value);
          } else {
            flatObj[key] = value;
          }
        });
        cssObj = restoreGlobals(flatObj, globalMap);
      }
    });
  } catch (error) {
    // console.error(error);
  }

  return cssObj;
};

const formatCSSString = (cssObj: CSSObj, indent = "") => {
  let code = "";
  const entriesCSSObj = Object.entries(cssObj);
  const lastIndex = entriesCSSObj.length - 1;

  entriesCSSObj.forEach(([key, value], index) => {
    if (typeof value === "object") {
      // 顶层规则之间空一行，嵌套规则之间只换行
      const prefix = !index ? "" : (indent === "" ? "\n\n" : "\n");
      code += `${prefix}${indent}${key} {\n` +
        `${formatCSSString(value, indent + "  ")}` +
        `\n${indent}}`;
    } else {
      // Less 变量定义（@xxx: value）不做 kebab 转换，保留原始名称
      const outputKey = key.startsWith('@') ? key : convertCamelToHyphen(key);
      code += `${indent}${outputKey}: ${value};${index === lastIndex ? "" : "\n"}`;
    }
  });

  return code;
};

export const stringifyLess = (cssObj: CSSObj) => {
  return formatCSSString(cssObj);
};
