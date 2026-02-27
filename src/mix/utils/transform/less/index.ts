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
      this.cssObj[key] = value
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
        debugger
        // @ts-ignore
        console.log("其它 => ", rule.type);
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
    const value = declaration.value.toCSS();

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

export const parseLess = (code: string) => {
  const less = window.less;
  let cssObj: CSSObj = {};

  try {
    less.render(code, (error, output) => {
      if (error) {
        console.error(error);
      } else {
        (less as any).parse(output!.css.replace(/\/\*[\s\S]*?\*\//g, ""), (error: any, output: any) => {
          if (error) {
            console.error(error);
          } else {
            const parse = new Parse(output);
            cssObj = parse.get();
          }
        })
      }
    })
  } catch (error) {
    console.error(error);
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
 */
const splitSelectorKeys = (selector: string): string[] => {
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
