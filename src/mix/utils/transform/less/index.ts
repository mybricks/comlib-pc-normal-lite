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

const getSelector = (selectors: Rule["selectors"]) => {
  let selector = selectors?.reduce((pre, selector, index) => {
    return pre + (index ? ",": "") + selector.toCSS();
  }, "") || "";

  return selector.slice(1, selector.length).trim();
}

const flatCSSObjs = (cssObjs: CSSObj[]) => {
  return cssObjs.reduce<CSSObj>((pre, cssObj) => {
    if (cssObj.key === "&") {
      // 隐式&，出现于媒体查询以及其它 @
      Object.entries(cssObj.value).forEach(([key, value]) => {
        pre[key] = value;
      });
    } else {
      pre[cssObj.key] = cssObj.value;
    }
    
    return pre;
  }, {})
}

class Parse {

  cssObj: CSSObj = {};

  constructor(private _ruleSet: RuleSet) {
    const res = this.handleRuleSet(this._ruleSet);
    res.forEach(({key, value}) => {
      if (this.cssObj[key] && typeof this.cssObj[key] === 'object' && typeof value === 'object') {
        this.cssObj[key] = { ...this.cssObj[key], ...value }
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

  handleRuleSet(ruleSet: RuleSet) {
    const selector = ruleSet.root ? "" : getSelector(ruleSet.selectors);
    const res: {key: string, value: CSSObj}[] = [];
    const { cssObj, cssObjs }  = this.handleRules(ruleSet.rules);

    if (selector) {
      res.push({
        key: selector,
        value: cssObj
      })
    }

    return res.concat(...cssObjs);
  }

  handleDeclaration(declaration: Declaration) {
    let key = "";
    if (typeof declaration.name === "string") {
      key = declaration.name;
    } else {
      key = declaration.name[0].toCSS();
    }
    const value = declaration.value.toCSS() + (declaration.important || "");

    return {
      key: convertHyphenToCamel(key),
      value
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
    const { cssObjs }  = this.handleRules(media.rules);

    return {
      key: features,
      value: flatCSSObjs(cssObjs),
    }
  }

  handleAtRule(atRule: AtRule) {
    const name = atRule.name;
    const value = atRule.value.toCSS();
    const { cssObjs } = this.handleRules(atRule.rules);

    return {
      key: `${name} ${value}`,
      value: flatCSSObjs(cssObjs),
    }
  }
}

/**
 * 从原始 Less 代码中提取所有 :global(...) 表达式，替换为合法的占位符类名。
 * 使用括号计数器处理嵌套括号（如 :global(.a:not(.b))），跳过注释区域。
 *
 * 返回：
 *   sanitized  - 占位符替换后的 Less 代码，可直接送入 less.render()
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
      // 输出时：占位符作为后代选择器（加空格）还是拼接（&前缀）需保留原始上下文中的 & 前缀
      // 这里只替换 :global(...) 本身，& 在 code 中紧邻于前，保持不变
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
 * 将 cssObj 所有层级的 key 中的占位符还原为原始选择器内容。
 * 深度递归处理，兼容 @media 嵌套结构。
 *
 * 注意：还原后含 combinator 的 global 内容（如 ".ant-picker-input > input"）
 * 会被 splitSelectorKeys 拆分为多层嵌套，这在 Less 中语义等价，不影响正确性。
 */
const restoreGlobals = (cssObj: CSSObj, globalMap: Map<string, string>): CSSObj => {
  if (globalMap.size === 0) return cssObj;

  const restoreKey = (key: string): string => {
    // 遍历 globalMap，精确替换所有占位符（避免正则对 prefix 格式的依赖）
    let result = key;
    globalMap.forEach((original, placeholder) => {
      // 用空字符串 join，让 split 保留上下文中的原有空格：
      //   ".parent.__gbl_0"（&:global 拼接）→ [".parent", ""] → ".parent" + ".ant-xxx" = ".parent.ant-xxx"
      //   ".parent .__gbl_0"（子代 :global）→ [".parent ", ""] → ".parent " + ".ant-xxx" = ".parent .ant-xxx"
      result = result.split(`.${placeholder}`).join(original);
    });
    // 合并多余空格，去首尾
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

export const parseLess = (code: string) => {
  const less = window.less;
  let cssObj: CSSObj = {};

  const { sanitized, globalMap } = extractGlobals(code);

  try {
    less.render(sanitized, (error, output) => {
      if (error) {
        // console.error(error);
      } else {
        (less as any).parse(output!.css.replace(/\/\*[\s\S]*?\*\//g, ""), (error: any, output: any) => {
          if (error) {
            // console.error(error);
          } else {
            const parse = new Parse(output);
            cssObj = restoreGlobals(parse.get(), globalMap);
          }
        })
      }
    })
  } catch (error) {
    // console.error(error);
  }

  return cssObj
}

const formatCSSString = (cssObj: CSSObj, indent = "") => {
  let code = "";
  const entriesCSSObj = Object.entries(cssObj);
  const lastIndex = entriesCSSObj.length - 1;

  entriesCSSObj.forEach(([key, value], index) => {
    if (typeof value === "object") {
      code += `${!index ? "" : (!indent ? "\n\n" : "\n")}${indent}${key} {\n` + 
        `${formatCSSString(value, indent + "  ")}` +
        `\n${indent}}`;
    } else {
      code += `${indent}${convertCamelToHyphen(key)}: ${value};${index === lastIndex ? "" : "\n"}`;
    }
  })

  return code;
}

/** 仅包含组合符（Combinator）的 token，在 Less 中应与下一段选择器合并，如 "> div" */
const COMBINATOR_ONLY = /^[>+~]+$/;

/**
 * 按「选择器片段」分割：空格分割后，将单独的 > + ~ 与下一段合并，
 * 避免 ".btnContainer > div" 被错误拆成 .btnContainer / > / div 导致反解析为 "> { div {} }"
 *
 * @keyframes、@media 等 at-rule key 整体不可拆分，直接作为单段返回，
 * 否则 "@keyframes scrollLeft" 会被拆成 ["@keyframes", "scrollLeft"]，
 * 导致 formatCSSString 输出 "@keyframes {" 缺少 identifier，Less 编译报错。
 */
const splitSelectorKeys = (selector: string): string[] => {
  if (selector.trimStart().startsWith("@")) return [selector];
  // 含逗号的多选择器整体不可拆分，避免 ".a, .b" 被拆成 [".a,", ".b"] 后重建为非法嵌套
  if (selector.includes(",")) return [selector];

  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts;

  const merged: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (COMBINATOR_ONLY.test(part) && i + 1 < parts.length) {
      merged.push(part + " " + parts[i + 1]);
      i += 1;
    } else {
      merged.push(part);
    }
  }
  return merged;
};

const rebuildCSSObj = (cssObj: CSSObj) => {
  const cache: CSSObj = {};
  Object.entries(cssObj).forEach(([key, value]) => {
    const splitKeys = splitSelectorKeys(key);

    if (splitKeys.length === 1) {
      cache[key] = value;
    } else {
      const firstKey = splitKeys[0];
      // 始终按嵌套还原：若首段尚不存在则先占位为对象，再写入后续层级，避免被写成扁平 key
      if (!cache[firstKey]) {
        cache[firstKey] = {};
      }
      deepSetCssObj(cache[firstKey] as CSSObj, {
        keys: splitKeys.slice(1),
        value
      });
    }
  })

  return cache;
}

const deepSetCssObj = (cssObj: CSSObj, { keys, value }: { keys: string[], value: CSSObj}) => {
  const keysLength = keys.length;
  keys.forEach((key, index) => {
    if (!cssObj[key]) {
      if (index === keysLength - 1) {
        cssObj[key] = value
      } else {
        cssObj[key] = {};
        cssObj = cssObj[key]
      }
    } else {
      if (index === keysLength - 1) {
        cssObj[key] = Object.assign(cssObj[key], value);
      } else {
        cssObj = cssObj[key];
      }
    }
  })
}

export const stringifyLess = (cssObj: CSSObj) => {
  return formatCSSString(rebuildCSSObj(cssObj));
}
