import React from 'react';
import LowcodeView, { lowcodeViewEvents } from "./lowcodeView";
import lowcodeViewCss from "./lowcodeView/index.lazy.less";
import context from "./context";
import { ANTD_KNOWLEDGES_MAP, ANTD_ICONS_KNOWLEDGES_MAP } from "./knowledges";
import { parseLess, stringifyLess } from "./utils/transform/less";
import { deepClone } from "./utils/normal";
import { convertHyphenToCamel } from "../utils/string";
import { MYBRICKS_KNOWLEDGES_MAP, HTML_KNOWLEDGES_MAP } from "./context/constants";
import { generateCodeStructure, exportCode, isExportSupported } from "../utils/code-export";
import "../utils/antd";
import "./utils/dom-to-json";

function evalConfigJsCompiled(code: string) {
  const evalStr = `
    let result;
    ${code.replace('export default', 'result =')};
    result; // 最后一行返回结果
  `;

  try {
    return eval(evalStr);
  } catch (error) {
    console.error('eval执行失败：', error);
    return null;
  }
}

function detectJsonIndent(jsonStr: string): string | number {
  const match = jsonStr.match(/\n([ \t]+)/);
  if (match) return match[1];
  return 2;
}

interface Props {
  /** 组件数据源 */
  data: any;
  /** 是否为编码模式，该模式下，展示默认选区 */
  isLowCodeMode: boolean;
  /** 组件id */
  id: string;
  model?: any;
  /** 选区 */
  focusArea: any;
}

interface Actions {
  getFocusArea
  lock
  notifyChanged
  unlock
}

const CSS_SHORTHAND_GROUPS: Record<string, string[]> = {
  'margin': ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  'background': ['background-color', 'background-image', 'background-repeat', 'background-position', 'background-size', 'background-attachment', 'background-origin', 'background-clip'],
};

const LONGHAND_TO_SHORTHAND: Record<string, string> = {};
Object.entries(CSS_SHORTHAND_GROUPS).forEach(([shorthand, longhands]) => {
  longhands.forEach(longhand => { LONGHAND_TO_SHORTHAND[longhand] = shorthand; });
});

function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** 去掉选择器尾部伪类/伪元素，返回基础路径 */
function getBaseSelector(selector: string): string {
  return selector.replace(/:{1,2}[a-zA-Z-]+(\([^)]*\))?$/, '').trim();
}

/**
 * 找出 cssObj 中与 targetSelector 同元素的孤儿 key（含伪类变体），用于清空后联动删除。
 */
function findOrphanKeys(cssObj: Record<string, any>, targetSelector: string): string[] {
  const segments = targetSelector.trim().split(/\s+/).filter(Boolean);
  const lastSegment = segments[segments.length - 1]; // 如 ".primary"

  return Object.keys(cssObj).filter(key => {
    if (key === targetSelector) return false;
    const base = getBaseSelector(key);

    // 原有逻辑：base 与 targetSelector 完全匹配，或 targetSelector 以 " base" 结尾
    if (base === targetSelector || targetSelector.endsWith(' ' + base)) return true;

    // 根层级复合类（如 ".actionBtn.secondary"）时匹配其伪类变体；多段路径不触发，避免误删真实规则
    if (
      segments.length === 1 &&
      lastSegment.startsWith('.') &&
      base.endsWith(lastSegment) &&
      !base.includes(' ')
    ) {
      return true;
    }

    return false;
  });
}

/**
 * 将 targetKey 路径中间节点的孤立根层级 key 并入嵌套路径，避免 stringifyLess 输出根层级孤立块。
 * 若某中间节点被多个父容器共享则跳过，保守处理。
 */
function absorbOrphans(cssObj: Record<string, any>, targetKey: string): void {
  const segments = targetKey.trim().split(/\s+/).filter(Boolean);

  if (segments.length < 3) return;

  for (let i = 1; i < segments.length - 1; i++) {
    const candidate = segments[i];

    if (!candidate.startsWith('.') || !cssObj[candidate]) continue;

    const parentRoots = new Set(
      Object.keys(cssObj)
        .filter(key => {
          const segs = key.trim().split(/\s+/);
          return segs.length > 1 && segs.includes(candidate);
        })
        .map(key => key.trim().split(/\s+/)[0])
    );

    if (parentRoots.size > 1) continue;

    const nestedPath = segments.slice(0, i + 1).join(' ');

    cssObj[nestedPath] = { ...cssObj[candidate], ...(cssObj[nestedPath] ?? {}) };

    delete cssObj[candidate];
  }
}

/** 删除 CSS 属性时，长写与简写互相扩展（兼容驼峰和 kebab-case） */
function expandDeletions(deletions: string[]): string[] {
  const toDelete = new Set(deletions);
  deletions.forEach(key => {
    const kebabKey = camelToKebab(key);
    const shorthand = LONGHAND_TO_SHORTHAND[kebabKey] ?? LONGHAND_TO_SHORTHAND[key];
    if (shorthand) toDelete.add(shorthand);
    const longhands = CSS_SHORTHAND_GROUPS[kebabKey] ?? CSS_SHORTHAND_GROUPS[key];
    if (longhands) longhands.forEach(lh => toDelete.add(lh));
  });
  return Array.from(toDelete);
}

/**
 * 从 cssObj 中找与目标元素 classList 精确对应的复合类名 key。
 * 条件：key 为单段（无空格），且 key 中解析出的所有类名都包含在 eleClassList 中。
 * 若有多个满足条件的 key，返回「匹配类名数最多」的（最精确）。
 */
function findCompoundClassKey(
  cssObj: Record<string, any>,
  eleClassList: string[]
): string | undefined {
  const validClasses = new Set(eleClassList.filter(c => c && c !== 'undefined'));

  let best: string | undefined;
  let bestCount = 0;

  for (const key of Object.keys(cssObj)) {
    if (key.includes(' ')) continue;

    // 解析 key 中的类名，如 ".actionBtn.secondary" → ["actionBtn", "secondary"]
    const classes = (key.match(/\.([^.#[:]+)/g) ?? []).map(c => c.slice(1));
    if (classes.length < 2) continue; // 单类名已由后缀收缩处理

    if (classes.every(c => validClasses.has(c)) && classes.length > bestCount) {
      best = key;
      bestCount = classes.length;
    }
  }

  return best;
}

const genStyleValue = (params) => {
  const { comId } = params;
  return {
    set(params, value) {
      const deletions: string[] | null = (window as any).__mybricks_style_deletions
      const aiComParams = context.getAiComParams(comId);
      const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));

      // const activeZoneSelector: string | undefined = (window as any).__mybricks_active_zone_selector
      // const fullSelector = activeZoneSelector ?? params.selector;
      const fullSelector = params.selector;

      // debugger
      // console.log("组件接收selector",fullSelector)

      const segments = fullSelector.trim().split(/\s+/).filter(Boolean);

      // 确定写入目标 key：阶段1 后缀遍历匹配（取最长路径）→ 阶段2 后缀收缩匹配 → 阶段3 复合类名匹配 → 兜底新建
      const ele: Element | null = params.focusArea?.ele ?? null;
      const eleClassList = ele ? Array.from(ele.classList) as string[] : [];

      // 后缀遍历匹配：在 cssObj 中找以 fullSelector 为路径后缀的 key，取路径最长（最具体）的一个。
      // 优先于精确匹配，防止历史错误写入的浅层 key 被再次命中。
      // 已知局限：若存在两个等长的不同根路径（如 .a .x 与 .b .x），仍无法区分，取首个。
      const suffixMatchKey = Object.keys(cssObj)
        .filter(k => k === fullSelector || k.endsWith(' ' + fullSelector))
        .sort((a, b) => b.length - a.length)[0];

      const shrinkMatchKey = segments.slice(1).reduce((found: string | undefined, _, i) => {
        if (found) return found;
        const candidate = segments.slice(i + 1).join(' ');
        return cssObj[candidate] !== undefined ? candidate : undefined;
      }, undefined) as string | undefined;

      const compoundMatchKey = eleClassList.length > 0 ? findCompoundClassKey(cssObj, eleClassList) : undefined;

      const targetKey: string =
        suffixMatchKey
        ?? shrinkMatchKey
        ?? compoundMatchKey
        ?? fullSelector;

      // Step 3.5：将路径中间节点的孤立根层级 key 并入嵌套结构，避免输出多余的根层级块
      absorbOrphans(cssObj, targetKey);

      if (!cssObj[targetKey]) {
        cssObj[targetKey] = {};
      }

      Object.entries(value).forEach(([key, value]) => {
        cssObj[targetKey][key] = value;
      })

      if (deletions && deletions.length > 0) {
        const expandedDeletions = expandDeletions(deletions);
        expandedDeletions.forEach(key => delete cssObj[targetKey][key]);
      }

      // targetKey 清空后，联动删除同元素的孤儿 key（含伪类变体）
      if (Object.keys(cssObj[targetKey] || {}).length === 0) {
        const orphanKeys = findOrphanKeys(cssObj, targetKey);
        orphanKeys.forEach(key => delete cssObj[key]);
        delete cssObj[targetKey];
      }

      const cssStr = stringifyLess(cssObj);
      context.updateFile(comId, { fileName: 'style.less', content: cssStr })
    }
  }
}

const genResizer = () => {
  let cssObj = {};
  let cssObjKey = ""

  return  {
    type: '_resizer',
    value: {
      get() {
      },
      set(params, value, status) {
        if (status.state === 'start') {
          if (!params.selector) return;
          const comId = params.id;
          const aiComParams = context.getAiComParams(comId);
          cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
          const match = params.selector?.match(/\[data-zone-selector=\[["']([^"']+)["']\]\]/);
          const selector = match?.[1] ?? params.selector;
          cssObjKey = Object.keys(cssObj).find(key => key.endsWith(selector)) ?? selector;
      
          if (!cssObj[cssObjKey]) {
            cssObj[cssObjKey] = {};
          }
          // let { cn } = JSON.parse(params.focusArea.dataset.loc);
          // if (typeof cn === 'string') {
          //   // [TODO] 兼容，后续去除
          //   cn = [cn]
          // }
          // cn = cn[0]
          // const aiComParams = context.getAiComParams(params.id);
          // cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
          // const className = `.${cn}`;
          // cssObjKey = Object.keys(cssObj).find(key => key.endsWith(className)) || className;
        } else if (status.state === 'ing') {
          if (!cssObjKey || !cssObj[cssObjKey]) return;
          Object.entries(value).forEach(([key, value]) => {
            cssObj[cssObjKey][key] = `${value}px`;
          })
          const cssStr = stringifyLess(cssObj);
          context.updateFile(params.id, { fileName: 'style.less', content: cssStr })
        }
      }
    }
  }
}

export default function (props: Props, actions: Actions, ...args) {
  if (!props?.data || !props?.id) {
    return {};
  }

  const { data, isLowCodeMode } = props;
  const focusAreaConfigs: any = {};

  //console.log('props', props, actions, ...args);

  // try {
  //   const configs = evalConfigJsCompiled(decodeURIComponent(data.configJsCompiled));
  //   const rawConfig = decodeURIComponent(data.modelConfig);
  //   const model = JSON.parse(rawConfig);

  //   Object.entries(configs).forEach(([key, value]: any) => {
  //     const items: any[] = [];

  //     value.items?.forEach((item) => {
  //       items.push({
  //         ...item,
  //         value: {
  //           get({ focusArea }) {
  //             return item.value.get({ data: model, index: Number(focusArea.dataset.mapIndex) });
  //           },
  //           set({ data, focusArea }, value) {
  //             item.value.set({ data: model, index: Number(focusArea.dataset.mapIndex) }, value);
  //             data.modelConfig = encodeURIComponent(JSON.stringify(model, null, detectJsonIndent(rawConfig)));
  //           }
  //         }
  //       })
  //     })

  //     value.style?.forEach((style) => {
  //       style.items?.forEach((item) => {
  //         item.valueProxy = genStyleValue({ comId: props.model?.runtime?.id || props.id });
  //       })
  //     })

  //     focusAreaConfigs[key] = {
  //       ...value,
  //       items,
  //     }
  //   })
  // } catch {}

  // try {
  //   const componentConfig = JSON.parse(decodeURIComponent(data.componentConfig));
  //   if (componentConfig.outputs?.length) {
  //     const eventsConfig = {
  //       title: "事件",
  //       items: componentConfig.outputs.map(({ id, title }) => {
  //         return {
  //           title,
  //           type: '_Event',
  //           options: {
  //             outputId: id
  //           }
  //         }
  //       })
  //     }

  //     if (!focusAreaConfigs[':root']) {
  //       focusAreaConfigs[':root'] = {
  //         items: [eventsConfig]
  //       }
  //     } else {
  //       focusAreaConfigs[':root'].items.push(eventsConfig);
  //     }
  //   }
  // } catch {}

  if (data.runtimeJsxConstituency) {
    data.runtimeJsxConstituency.forEach(({ className, component, source, jsdoc, selectors }) => {
      if (!component) {
        // [TODO] 通常是未处理到的标签，case by case 处理
        return;
      }
      if (typeof className === 'string') {
        // [TODO] 兼容，后续去除
        className = [className]
      }

      let knowledge: any = null;

      if (source === "antd") {
        knowledge = ANTD_KNOWLEDGES_MAP[component.toUpperCase()];
      } else if (source === "mybricks") {
        knowledge = MYBRICKS_KNOWLEDGES_MAP[component.toUpperCase()];
      } else if (source === "html") {
        // knowledge = HTML_KNOWLEDGES_MAP[component.toUpperCase()];
      } else if (source === "@ant-design/icons") {
        knowledge = ANTD_ICONS_KNOWLEDGES_MAP[component.toUpperCase()];
      }

      if (knowledge?.editors) {
        Object.keys(knowledge.editors).forEach((key) => {
          const editor = knowledge.editors[key];
          // const cn = `.${className[0]}`;
          // const selector = key === ":root" ? cn : `${cn} ${key}`;
          // const items = className.length === 1 ? [
          //   {
          //     title: '样式',
          //     autoOptions: true,
          //     valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id })
          //   }
          // ] : className.map((className) => {
          //   const target = key === ":root" ? `.${className}` : `.${className} ${key}`;
          //   return {
          //     title: "样式",
          //     autoOptions: true,
          //     valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id }),
          //     target,
          //   }
          // });

          selectors?.forEach((selector) => {
            const nextSelector = key === ":root" ? selector : `${selector} ${key}`;
            if (!focusAreaConfigs[nextSelector]) {
              focusAreaConfigs[nextSelector] = {
                title: editor.title || `.${className[0]}`,
                items: [],
                style: [
                  {
                    items: [
                      {
                        title: "样式",
                        autoOptions: true,
                        valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id }),
                      },
                      genResizer()
                    ]
                  }
                ]
              }
            } else {
              focusAreaConfigs[nextSelector].style = [
                {
                  items: [
                    {
                      title: "样式",
                      autoOptions: true,
                      valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id }),
                    },
                    genResizer()
                  ]
                }
              ]
            }
          })

          // if (!focusAreaConfigs[selector]) {
          //   focusAreaConfigs[selector] = {
          //     title: editor.title || cn,
          //     items: [],
          //     style: [
          //       {
          //         // items: [
          //         //   {
          //         //     title: '样式',
          //         //     autoOptions: true,
          //         //     valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id })
          //         //   }
          //         // ]
          //         items,
          //       }
          //     ]
          //   }
          // } else {
          //   focusAreaConfigs[selector].style = [
          //     {
          //       items,
          //       // items: [
          //       //   {
          //       //     title: '样式',
          //       //     autoOptions: true,
          //       //     valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id })
          //       //   }
          //       // ]
          //     }
          //   ]
          // }
          // if (jsdoc != null) {
          //   focusAreaConfigs[selector].specs = jsdoc;
          // }

          // if (key === ":root") {
          //   if (focusAreaConfigs[selector].items?.length) {
          //     focusAreaConfigs[selector].items.push(genResizer())
          //   }
          //   // if (!focusAreaConfigs[selector].items) {
          //   //   focusAreaConfigs[selector].items = [
          //   //     genResizer()
          //   //   ]
          //   // } else {
          //   //   focusAreaConfigs[selector].items.push(genResizer())
          //   // }
  
          //   focusAreaConfigs[selector].style.push(genResizer())
          // }
        })
      }

      // if (isLowCodeMode && knowledge?.editors) {
      //   Object.keys(knowledge.editors).forEach((key) => {
      //     const editor = knowledge.editors[key];
      //     const cn = `.${className[0]}`;
      //     const selector = key === ":root" ? cn : `${cn} ${key}`;
      //     if (!focusAreaConfigs[selector]) {
      //       focusAreaConfigs[selector] = {
      //         title: editor.title || cn,
      //         items: [],
      //         style: [
      //           {
      //             items: []
      //           }
      //         ]
      //       }
      //     }
      //   })
      // }
    })
  }

  // if (data.runtimeJsxConstituency) {
  //   data.runtimeJsxConstituency.forEach(({ className, component, source }) => {

  //     if (!component) {
  //       return;
  //     }

  //     if (typeof className === 'string') {
  //       // [TODO] 兼容，后续去除
  //       className = [className]
  //     }
  //     let knowledge: any = null;

  //     if (source === "antd") {
  //       knowledge = ANTD_KNOWLEDGES_MAP[component.toUpperCase()];
  //     } else if (source === "mybricks") {
  //       knowledge = MYBRICKS_KNOWLEDGES_MAP[component.toUpperCase()];
  //     } else if (source === "html") {
  //       knowledge = HTML_KNOWLEDGES_MAP[component.toUpperCase()];
  //     }

  //     if (knowledge?.editors) {
  //       Object.entries(knowledge.editors).forEach(([key, oriValue]: any) => {
  //         const value = deepClone(oriValue);
  //         if (value.style?.length) {
  //           value.style.forEach((style) => {
  //             const styleItems: any[] = style.items;
  //             const items: any = [];
  //             styleItems?.forEach((item) => {
  //               className.forEach((className) => {
  //                 const selector = key === ":root" ? `.${className}` : `.${className} ${key}`;
  //                 items.push({
  //                   ...item,
  //                   valueProxy: {
  //                     set(params, value) {
  //                       const comId = props.model?.runtime?.id || props.id;
  //                       const aiComParams = context.getAiComParams(comId);
  //                       const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
  //                       const selector = params.selector;
    
  //                       if (!cssObj[selector]) {
  //                         cssObj[selector] = {};
  //                       }
    
  //                       Object.entries(value).forEach(([key, value]) => {
  //                         cssObj[selector][key] = value;
  //                       })
    
  //                       const cssStr = stringifyLess(cssObj);
  //                       context.updateFile(comId, { fileName: 'style.less', content: cssStr })
  //                     }
  //                   },
  //                   target: `${selector}${item.target || ""}`,
  //                   domTarget: `${selector}`
  //                 })
  //               })
  //             })
  //             style.items = items;
  //           })
  //         }

  //         const mergeItems: any = [];

  //         if (value.items?.length) {
  //           value.items.forEach((item) => {
  //             if (item.type === '_resizer') {
  //               let cssObj = {};
  //               let cssObjKey = ""
  //               mergeItems.push({
  //                 ...item,
  //                 value: {
  //                   get() {
  //                     console.log("[@_resizer -get]");
  //                   },
  //                   set(params, value, status) {
  //                     if (status.state === 'start') {
  //                       let { cn } = JSON.parse(params.focusArea.dataset.loc);
  //                       if (typeof cn === 'string') {
  //                         // [TODO] 兼容，后续去除
  //                         cn = [cn]
  //                       }
  //                       cn = cn[0]
  //                       const aiComParams = context.getAiComParams(params.id);
  //                       cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
  //                       cssObjKey = `.${cn}`;
  //                     } else if (status.state === 'ing') {
  //                       Object.entries(value).forEach(([key, value]) => {
  //                         cssObj[cssObjKey][key] = `${value}px`;
  //                       })
  //                       const cssStr = stringifyLess(cssObj);
  //                       context.updateFile(params.id, { fileName: 'style.less', content: cssStr })
  //                     }
  //                   }
  //                 }
  //               })
  //             }
  //           })
  //           value.items = [];
  //         }

  //         const selector = key === ":root" ? `.${className[0]}` : `.${className[0]} ${key}`;
  //         const config = focusAreaConfigs[selector] ?? (focusAreaConfigs[selector] = value);

  //         if (config !== value) config.style = value.style;

  //         // 没有配置项且没有 style 时，添加默认空 style 编辑，保证是一个选区
  //         if (!config.items && !config.style?.length) {
  //           config.style = [{ items: [] }];
  //         }

  //         config.title ??= selector;
  //         config.items = config.items ? [...config.items, ...mergeItems] : mergeItems;
  //       })
  //     }
  //   })
  // }

  /** Figma 导入项：selectors 与 parseLess 的 key 一致，value 为样式键值 */
  type FigmaImportItem = { selectors: string[]; value: Record<string, string> };

  /** 去掉 Figma 选择器前可能带的组件 ID classname，便于与组件 less 的 key 匹配 */
  const normalizeFigmaSelector = (selector: string, comId: string): string => {
    if (!comId || !selector.startsWith('.')) return selector;
    const escaped = comId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\.${escaped}(\\.|\\s+)?`);
    return selector.replace(re, (_, suffix) => (suffix === '.' ? '.' : '')).trim();
  };

  /** 从 Figma JSON（含 selectors）同步样式到组件 style.less，只同步有差异的部分 */
  const syncStylesFromFigmaJson = (comId: string, figmaItems: FigmaImportItem[]) => {
    const aiComParams = context.getAiComParams(comId);
    if (!aiComParams?.data?.styleSource) {
      console.warn("[从 Figma 同步] 组件无 styleSource，跳过同步");
      return;
    }
    const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
    const componentSelectors = Object.keys(cssObj);
    let hasChange = false;
    const matched: string[] = [];
    const skipped: string[] = [];
    const diffs: { selector: string; key: string; from: string; to: string }[] = [];

    figmaItems.forEach((item) => {
      const { selectors, value: styles } = item;
      if (!Array.isArray(selectors) || selectors.length === 0 || !styles || typeof styles !== 'object') {
        skipped.push(String(selectors?.[0] ?? '(无 selectors)'));
        return;
      }
      const rawSelector = selectors[0];
      const selector = normalizeFigmaSelector(rawSelector, comId);
      if (!selector) {
        skipped.push(rawSelector);
        return;
      }
      const cssObjKey = Object.keys(cssObj).find(
        (key) => key === selector || key.endsWith(' ' + selector)
      ) ?? null;
      if (!cssObjKey || !cssObj[cssObjKey]) {
        skipped.push(selector);
        return;
      }
      matched.push(cssObjKey);
      Object.entries(styles).forEach(([cssKey, figmaValue]) => {
        const camelKey = convertHyphenToCamel(cssKey);
        const currentValue = cssObj[cssObjKey][camelKey];
        if (currentValue !== figmaValue) {
          diffs.push({ selector: cssObjKey, key: camelKey, from: String(currentValue ?? ''), to: figmaValue });
          cssObj[cssObjKey][camelKey] = figmaValue;
          hasChange = true;
        }
      });
    });

    if (hasChange) {
      const cssStr = stringifyLess(cssObj);
      context.updateFile(comId, { fileName: 'style.less', content: cssStr });
    }
  };

  const exportCodeConfig = {
    title: "导出",
    items: [
      {
        title: "导出为代码",
        type: "Button",
        value: {
          async set(params: { id?: string; focusArea?: any; data?: any }, _value: any) {
            const comId = params?.id;
            if (!comId) {
              console.warn("[导出为代码] 无组件 ID");
              return;
            }
            try {
              const aiComParams = context.getAiComParams(comId);
              if (!aiComParams?.data) {
                console.error("[导出为代码] 组件数据不存在");
                return;
              }
              const files = generateCodeStructure(aiComParams.data);
              if (!isExportSupported()) {
                alert('当前环境不支持导出，请使用 Chrome、Edge 或在 VSCode 中打开');
                return;
              }
              const message = (window as any).antd?.message;
              let hideLoading: any = null;
              if (message) hideLoading = message.loading('正在导出代码...', 0);
              await exportCode(files, {
                folderName: 'mybricks-component',
                onProgress: (progress) => {
                  console.log(`[导出进度] ${progress.progress}% - ${progress.currentFile}`);
                },
              });
              if (hideLoading) hideLoading();
              if (message) message.success('导出代码成功！');
              else alert('导出代码成功！');
            } catch (error) {
              const message = (window as any).antd?.message;
              if ((error as any)?.message?.includes('取消')) {
                console.log('[导出为代码] 用户取消导出');
              } else {
                if (message) message.error(`导出失败: ${(error as any)?.message || '未知错误'}`);
                else alert(`导出失败: ${(error as any)?.message || '未知错误'}`);
                console.error('[导出为代码] 导出失败', error);
              }
            }
          }
        }
      }
    ]
  };

  if (!focusAreaConfigs[':root']) {
    focusAreaConfigs[':root'] = {
      items: [exportCodeConfig]
    };
  } else {
    focusAreaConfigs[':root'].items.push(exportCodeConfig);
  }

  context.setAiCom(props.id, { params: props, actions });

  context.createVibeCodingAgent({ register: window._registerAgent_ })

  return {
    ...focusAreaConfigs,
    /** 可调整宽高 */
    '@resize': {
      options: ['width', 'height'],
    },
    '@error': (err) => {
      const aiComParams = context.getAiComParams(props.id);
      if (aiComParams?.data) {
        const data = aiComParams.data;
        if (!data._errors) data._errors = [];
        data._errors = data._errors.filter((e: any) => e.file);
        data._errors.push({ message: err.message, type: 'runtime' });
        context.getAiCom(props.id)?.actions?.notifyChanged?.();
      }
    },
    /** 代码编辑器面板 */
    '@lowcode':{
      render(params, plugins){
        context.plugins = plugins;

        const showAIDialog = plugins.showAIDialog;
        (window as any)._showAIDialog_ = showAIDialog;

        return (
          <LowcodeView {...params}/>
        )
      },
      useCSS(){
        return [
          lowcodeViewCss
        ]
      }
    },
    '@debug'(params, stop) {
      if (stop) {
        data.debugTarget = undefined;
        return;
      }

      const page = params.focusArea.ele.closest('[data-desn-page]');
      const pageIndex = page?.getAttribute("data-desn-page");

      if (pageIndex) {
        // 当前页在视口中的矩形（相对视口左上角）
        const pageBCR = page.getBoundingClientRect();
        const rootEl = page.parentElement;
        // 根容器的视口矩形
        const rootBCR = rootEl.getBoundingClientRect();
        const rootComputedStyle = window.getComputedStyle(rootEl);

        // 根容器的内边距和左边框，用于把「视口坐标」换算成「内容区坐标」
        const paddingLeft = parseFloat(rootComputedStyle.paddingLeft || "0");
        const paddingRight = parseFloat(rootComputedStyle.paddingRight || "0");
        const paddingTop = parseFloat(rootComputedStyle.paddingTop || "0");
        const paddingBottom = parseFloat(rootComputedStyle.paddingBottom || "0");
        const borderLeft = parseFloat(rootComputedStyle.borderLeftWidth || "0");

        // 根容器的布局尺寸（含 padding + border，不含 margin）
        const layoutWidth = rootEl.offsetWidth;
        const layoutHeight = rootEl.offsetHeight;

        // 写入调试目标：供预览/调试时定位当前页、同步根容器尺寸
        data.debugTarget = {
          type: 'page',
          pageIndex: Number(pageIndex),
          style: {
            // 水平位移：把「页相对根容器」的视口距离，按根容器缩放比换算成布局坐标，再减去左边框和内边距
            transform: `scale(1) translate(${(pageBCR.left - rootBCR.left) / (rootBCR.width / layoutWidth) - borderLeft - paddingLeft}px, 0px)`
          },
          rootStyle: {
            // 根容器内容区宽高（去掉 padding 后的可排版区域）
            width: layoutWidth - paddingLeft - paddingRight,
            height: layoutHeight - paddingTop - paddingBottom,
          }
        };
      }
    },
    '@viewCode'(params) {
      const dataLoc = params.focusArea.ele.closest('[data-loc]')?.getAttribute('data-loc');

      if (dataLoc) {
        const loc = JSON.parse(dataLoc);
        const { codeLine } = loc;
        if (codeLine) {
          const { start, end } = codeLine;
          lowcodeViewEvents.emit('viewCode', [start, end]);
        } else {
          console.error('[@viewCode] 请重新编译jsx，支持codeLine', params);
        }
      } else {
        console.error('[@viewCode] 未找到 data-loc', params);
      }
    },
    '[data-desn-page]': {
      title: "页面",
      items: (pageProps, cate1) => {
        const { focusArea, data } = pageProps;
        const comId = props.id;
        // focusArea 是被点选的 [data-desn-page] DOM 元素
        // data-desn-page={N} → dataset.desnPage === "N"
        const pageIndex = Number(focusArea?.dataset?.desnPage ?? 0);
        const isDebugging =
          data.debugTarget?.type === 'page' &&
          data.debugTarget?.pageIndex === pageIndex;

        // console.log('data', data);
        // console.log('focusArea', focusArea);

        cate1.title = "页面";
        cate1.items = [
          {
            title: "Figma",
            items: [
              {
                title: "导出此页面到 Figma",
                type: 'Button',
                value: {
                  set() {
                    const fn = (window as any).elementToMybricksJson;
                    if (typeof fn !== 'function') {
                      console.warn("[导出页面] window.elementToMybricksJson 未定义");
                      return;
                    }
                    const ele = focusArea?.ele;
                    if (!ele) {
                      console.warn("[导出页面] focusArea.ele 不存在");
                      return;
                    }
                    const result = fn(ele, comId);
                    const jsonStr = typeof result === 'object' && result !== null
                      ? JSON.stringify(result, null, 2)
                      : String(result);
                    navigator.clipboard.writeText(jsonStr).then(
                      () => console.log("[导出页面] 复制成功"),
                      (err) => console.error("[导出页面] 复制失败", err)
                    );
                  }
                }
              },
              {
                title: "从 Figma 同步此页面样式",
                type: 'Button',
                value: {
                  set() {
                    navigator.clipboard.readText().then(
                      (text) => {
                        if (!text || String(text).trim() === '') {
                          alert('剪切板无内容，请先从 Figma 复制后再同步');
                          return;
                        }
                        try {
                          const parsed = JSON.parse(text);
                          const figmaItems: FigmaImportItem[] = Array.isArray(parsed) ? parsed : [parsed];
                          syncStylesFromFigmaJson(comId, figmaItems);
                        } catch (e) {
                          console.error("[从 Figma 同步页面] 剪切板内容不是合法 JSON", e);
                          alert('剪切板内容不是合法 JSON，请确认已从 Figma 正确复制');
                        }
                      },
                      (err) => {
                        console.error("[从 Figma 同步页面] 读取剪切板失败", err);
                        alert('读取剪切板失败，请检查浏览器权限或剪切板是否有内容');
                      }
                    );
                  }
                }
              }
            ]
          }
        ];
        return;
      }
    },
    '[data-zone-selector]': {
      style: [
        {
          items: [
            {
              title: "样式",
              autoOptions: true,
              valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id }),
            },
            genResizer()
          ]
        }
      ]
    },
    '[data-library-source]':{}
    /** 初始化 */
    // '@init': () => {},
    /** 保存的回调 */
    // '@save'() {},
    /** toJSON的回调 */
    // '@toJSON'(){},
  }
}