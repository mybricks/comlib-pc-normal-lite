import React from 'react';
import LowcodeView from "./lowcodeView";
import lowcodeViewCss from "./lowcodeView/index.lazy.less";
import context from "./context";
import { ANTD_KNOWLEDGES_MAP, ANTD_ICONS_KNOWLEDGES_MAP } from "./knowledges";
import { parseLess, stringifyLess } from "./utils/transform/less";
import { deepClone } from "./utils/normal";
import { convertHyphenToCamel } from "../utils/string";
import { MYBRICKS_KNOWLEDGES_MAP, HTML_KNOWLEDGES_MAP } from "./context/constants";
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
};

const LONGHAND_TO_SHORTHAND: Record<string, string> = {};
Object.entries(CSS_SHORTHAND_GROUPS).forEach(([shorthand, longhands]) => {
  longhands.forEach(longhand => { LONGHAND_TO_SHORTHAND[longhand] = shorthand; });
});

function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** 扩展待删除 key：删长写时顺带删简写，删简写时顺带删所有长写（兼容驼峰和 kebab-case） */
function expandDeletions(deletions: string[]): string[] {
  const toDelete = new Set(deletions);
  deletions.forEach(key => {
    const kebabKey = camelToKebab(key);
    // 长写 → 找对应简写（如 marginTop/margin-top → margin）
    const shorthand = LONGHAND_TO_SHORTHAND[kebabKey] ?? LONGHAND_TO_SHORTHAND[key];
    if (shorthand) toDelete.add(shorthand);
    // 简写 → 找对应所有长写（如 margin → margin-top 等）
    const longhands = CSS_SHORTHAND_GROUPS[kebabKey] ?? CSS_SHORTHAND_GROUPS[key];
    if (longhands) longhands.forEach(lh => toDelete.add(lh));
  });
  return Array.from(toDelete);
}

const genStyleValue = (params) => {
  const { comId } = params;
  return {
    set(params, value) {
      const deletions: string[] | null = (window as any).__mybricks_style_deletions
      const aiComParams = context.getAiComParams(comId);
      const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
      // const selector = params.selector;
      const match = params.selector.match(/\[data-zone-selector=\[["']([^"']+)["']\]\]/);
      const selector = match?.[1] || params.selector;
      const cssObjKey = Object.keys(cssObj).find(key => key.endsWith(selector)) || selector;
  
      if (!cssObj[cssObjKey]) {
        cssObj[cssObjKey] = {};
      }
  
      Object.entries(value).forEach(([key, value]) => {
        cssObj[cssObjKey][key] = value;
      })

      if (deletions && deletions.length > 0) {
        const expandedDeletions = expandDeletions(deletions);
        expandedDeletions.forEach(key => delete cssObj[cssObjKey][key])
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
        console.log("[@_resizer -get]");
      },
      set(params, value, status) {
        if (status.state === 'start') {
          const comId = params.id;
          const aiComParams = context.getAiComParams(comId);
          cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
          const match = params.selector.match(/\[data-zone-selector=\[["']([^"']+)["']\]\]/);
          const selector = match?.[1] || params.selector;
          cssObjKey = Object.keys(cssObj).find(key => key.endsWith(selector)) || selector;
      
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

export default function (props: Props, actions: Actions) {
  if (!props?.data || !props?.id) {
    return {};
  }

  const { data, isLowCodeMode } = props;
  const focusAreaConfigs: any = {};

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

  const exportCategoryConfig = {
    title: "导出",
    items: [
      {
        title: "导出到 Figma",
        type: "Button",
        value: {
          set(params: { id?: string; focusArea?: any; data?: any }, value: any) {
            const comId = params?.id;
            const fn = (window as any).comToMybricksJson;
            if (typeof fn !== 'function') {
              console.warn("[导出] window.comToMybricksJson 未定义");
              return;
            }
            const result = fn(comId);
            const jsonStr = typeof result === 'object' && result !== null
              ? JSON.stringify(result, null, 2)
              : String(result);
            navigator.clipboard.writeText(jsonStr).then(
              () => console.log("[导出] 已复制到剪切板"),
              (err) => console.error("[导出] 复制失败", err)
            );
          }
        }
      },
      {
        title: "导出为代码",
        type: "Button",
        value: {
          set(_params: { id?: string; focusArea?: any; data?: any }, _value: any) {
            // TODO: 代码导出逻辑
          }
        }
      }
    ]
  };

  const importCategoryConfig = {
    title: "导入",
    items: [
      {
        title: "从 Figma 同步",
        type: "Button",
        value: {
          set(params: { id?: string; focusArea?: any; data?: any }, value: any) {
            const comId = params?.id;
            if (!comId) {
              console.warn("[从 Figma 同步] 无组件 ID");
              return;
            }
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
                  console.error("[从 Figma 同步] 剪切板内容不是合法 JSON", e);
                  alert('剪切板内容不是合法 JSON，请确认已从 Figma 正确复制');
                }
              },
              (err) => {
                console.error("[从 Figma 同步] 读取剪切板失败", err);
                alert('读取剪切板失败，请检查浏览器权限或剪切板是否有内容');
              }
            );
          }
        }
      }
    ]
  };

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

    console.log("[从 Figma 同步] 收到 Figma 条目数:", figmaItems.length, "组件现有选择器数:", componentSelectors.length);

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

    if (skipped.length > 0) {
      console.log("[从 Figma 同步] 未命中的选择器（组件 less 中不存在）:", skipped.length, "个", skipped.slice(0, 20), skipped.length > 20 ? "..." : "");
    }
    console.log("[从 Figma 同步] 命中的选择器:", matched.length, "个", matched.slice(0, 30), matched.length > 30 ? "..." : "");
    if (diffs.length > 0) {
      console.log("[从 Figma 同步] 有差异并已同步的样式:", diffs.length, "条");
      diffs.forEach((d) => console.log("  -", d.selector, d.key, d.from, "->", d.to));
    }

    if (hasChange) {
      const cssStr = stringifyLess(cssObj);
      context.updateFile(comId, { fileName: 'style.less', content: cssStr });
      console.log("[从 Figma 同步] 已写入 style.less，共更新", diffs.length, "条样式");
    } else {
      console.log("[从 Figma 同步] 无差异，未写入文件");
    }
  };

  if (!focusAreaConfigs[':root']) {
    focusAreaConfigs[':root'] = {
      items: [exportCategoryConfig, importCategoryConfig]
    };
  } else {
    focusAreaConfigs[':root'].items.push(exportCategoryConfig, importCategoryConfig);
  }

  context.setAiCom(props.id, { params: props, actions });

  context.createVibeCodingAgent({ register: window._registerAgent_ })

  return {
    ...focusAreaConfigs,
    /** 可调整宽高 */
    '@resize': {
      options: ['width', 'height'],
    },
    /** 代码编辑器面板 */
    '@lowcode':{
      render(params, plugins){
        context.plugins = plugins;

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
    }
    /** 初始化 */
    // '@init': () => {},
    /** 保存的回调 */
    // '@save'() {},
    /** toJSON的回调 */
    // '@toJSON'(){},
  }
}