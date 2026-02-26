import React from 'react';
import LowcodeView from "./lowcodeView";
import lowcodeViewCss from "./lowcodeView/index.lazy.less";
import context from "./context";
import { ANTD_KNOWLEDGES_MAP, ANTD_ICONS_KNOWLEDGES_MAP } from "./knowledges";
import { parseLess, stringifyLess } from "./utils/transform/less";
import { deepClone } from "./utils/normal";
import { MYBRICKS_KNOWLEDGES_MAP, HTML_KNOWLEDGES_MAP } from "./context/constants";
import "../utils/antd";

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

/**
 * 根据runtime className 生成友好的分类名称
 * 例如: 'button' -> '默认', 'buttonActive' -> '激活', 'buttonDisabled' -> '禁用'
 */
function getCatelogName(className: string, index: number): string {
  const lowerClassName = className.toLowerCase();
  
  // 常见状态映射
  const stateMap: Record<string, string> = {
    'active': '激活',
    'hover': '悬浮',
    'focus': '聚焦',
    'disabled': '禁用',
    'disable': '禁用',
    'selected': '选中',
    'checked': '选中',
    'error': '错误',
    'success': '成功',
    'warning': '警告',
    'loading': '加载中',
    'pressed': '按下',
    'visited': '已访问',
  };
  
  // 检查是否包含状态关键词
  for (const [key, label] of Object.entries(stateMap)) {
    if (lowerClassName.includes(key)) {
      return label;
    }
  }
  
  // 第一个类名默认为"默认"
  if (index === 0) {
    return '默认';
  }
  
  // 其他情况使用类名本身
  return className;
}

/**
 * 根据style中 伪类生成分类名称
 */
function getCatelogNameFromPseudo(pseudoClass: string): string {
  const pseudoMap: Record<string, string> = {
    'hover': '悬浮',
    'focus': '聚焦',
    'focus-visible': '聚焦可见',
    'active': '激活',
    'visited': '已访问',
    'disabled': '禁用',
    'checked': '选中',
    'first-child': '第一项',
    'last-child': '最后一项',
    'nth-child': '第N项',
    'before': '前置',
    'after': '后置',
  };
  
  return pseudoMap[pseudoClass] || pseudoClass;
}

/**
 * 从 styleSource 中提取某个类名相关的所有伪类选择器
 * 例如: '.mainBtn' -> ['.mainBtn:focus', '.mainBtn:hover', '.mainBtn:focus-visible']
 */
function extractPseudoSelectors(styleSource: string, baseClassName: string): Array<{ selector: string, pseudo: string, catelog: string }> {
  try {
    const cssObj = parseLess(decodeURIComponent(styleSource));
    const results: Array<{ selector: string, pseudo: string, catelog: string }> = [];
    
    Object.keys(cssObj).forEach(selector => {
      // 检查是否是目标类名的伪类选择器
      // 匹配 .mainBtn:focus 或 .mainBtn:focus-visible 等
      const regex = new RegExp(`\\${baseClassName}:([\\w-]+)`);
      const match = selector.match(regex);
      
      if (match) {
        const pseudo = match[1];
        results.push({
          selector: selector,
          pseudo: pseudo,
          catelog: getCatelogNameFromPseudo(pseudo)
        });
      }
    });
    
    return results;
  } catch (error) {
    console.error('解析 CSS 伪类选择器失败:', error);
    return [];
  }
}

const genStyleValue = (params) => {

  const { comId, id } = params;
  return {
    set(params, value) {
      const aiComParams = context.getAiComParams(comId);
      const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
      let selector = params.selector;

      // 伪类选择器的 target 拼接了组件类名前缀（如 ".u_8ncur .actionRow:hover"），
      // 但 parseLess 解析出的 key 不含该前缀，需要先剥离再匹配
      const componentClassPrefix = `.${id || comId} `;
      if (selector.startsWith(componentClassPrefix)) {
        selector = selector.slice(componentClassPrefix.length);
      }

      const cssObjKey = Object.keys(cssObj).find(key => key.endsWith(selector)) || selector;
  
      if (!cssObj[cssObjKey]) {
        cssObj[cssObjKey] = {};
      }

      // 从 window 侧通道读取删除信号（由 editors-pc-common handleChange 写入）
      // 因为编辑器删除了样式之后 data.styleSource 对应的样式并没有被删除，所以需要手动删除
      const deletions: string[] | undefined = (window as any).__mybricks_style_deletions;

      if (deletions) {
        (window as any).__mybricks_style_deletions = null;
        deletions.forEach(key => {
          delete cssObj[cssObjKey][key];
        });
      }
  
      Object.entries(value).forEach(([key, val]) => {
        cssObj[cssObjKey][key] = val;
      })
  
      const cssStr = stringifyLess(cssObj);
      context.updateFile(comId, { fileName: 'style.less', content: cssStr })
    }
  }
}

const genLayoutEditor = (cn: string) => {
  return {
    title: '布局',
    type: 'layout',
    value: {
      get(params) {
        const aiComParams = context.getAiComParams(params.id);
        if (!aiComParams?.data?.styleSource) return {};
        const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
        const cssObjKey = Object.keys(cssObj).find(key => key.endsWith(cn)) || '';
        return cssObj[cssObjKey] || {};
      },
      set(params, value) {

        const aiComParams = context.getAiComParams(params.id);
        const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
        const cssObjKey = Object.keys(cssObj).find(key => key.endsWith(cn)) || cn;
        if (!cssObj[cssObjKey]) cssObj[cssObjKey] = {};
        Object.entries(value).forEach(([key, val]) => {
          cssObj[cssObjKey][key] = val;
        });
        const cssStr = stringifyLess(cssObj);
        context.updateFile(params.id, { fileName: 'style.less', content: cssStr });
      }
    }
  };
};

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
          let { cn } = JSON.parse(params.focusArea.dataset.loc);
          if (typeof cn === 'string') {
            // [TODO] 兼容，后续去除
            cn = [cn]
          }
          cn = cn[0]
          const aiComParams = context.getAiComParams(params.id);
          cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
          const className = `.${cn}`;
          cssObjKey = Object.keys(cssObj).find(key => key.endsWith(className)) || className;
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

export default function (props: Props) {
  if (!props?.data) {
    return {};
  }

  const {id} = props;


  const { data, isLowCodeMode } = props;
  const focusAreaConfigs: any = {};

  const stringifyWithCircular = (obj: any) => {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      // 处理函数
      if (typeof value === 'function') {
        return `[Function: ${value.name || 'anonymous'}]`;
      }
      // 处理 undefined
      if (value === undefined) {
        return '[Undefined]';
      }
      // 处理循环引用
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    }, 2);
  };

  try {
    const configs = evalConfigJsCompiled(decodeURIComponent(data.configJsCompiled));
    const rawConfig = decodeURIComponent(data.modelConfig);
    const model = JSON.parse(rawConfig);

    //console.log("getEffectedCssPropertyAndOptions allStatesConfig result - 消费",stringifyWithCircular(data))

    Object.entries(configs).forEach(([key, value]: any) => {
      const items: any[] = [];

      value.items?.forEach((item) => {
        items.push({
          ...item,
          value: {
            get({ focusArea }) {
              return item.value.get({ data: model, index: Number(focusArea.dataset.mapIndex) });
            },
            set({ data, focusArea }, value) {
              item.value.set({ data: model, index: Number(focusArea.dataset.mapIndex) }, value);
              data.modelConfig = encodeURIComponent(JSON.stringify(model, null, detectJsonIndent(rawConfig)));
            }
          }
        })
      })

      value.style?.forEach((style) => {
        style.items?.forEach((item) => {
          item.valueProxy = genStyleValue({ comId: props.model?.runtime?.id || props.id, id: props.id });
        })
      })

      focusAreaConfigs[key] = {
        ...value,
        items,
      }
    })
  } catch {}

  try {
    const componentConfig = JSON.parse(decodeURIComponent(data.componentConfig));
    if (componentConfig.outputs?.length) {
      const eventsConfig = {
        title: "事件",
        items: componentConfig.outputs.map(({ id, title }) => {
          return {
            title,
            type: '_Event',
            options: {
              outputId: id
            }
          }
        })
      }

      if (!focusAreaConfigs[':root']) {
        focusAreaConfigs[':root'] = {
          items: [eventsConfig]
        }
      } else {
        focusAreaConfigs[':root'].items.push(eventsConfig);
      }
    }
  } catch {}

  if (data.runtimeJsxConstituency) {
    data.runtimeJsxConstituency.forEach(({ className, component, source }) => {
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
        //console.log('[antd component]', { component, componentUpper: component.toUpperCase(), knowledge, hasEditors: !!knowledge?.editors });
      } else if (source === "mybricks") {
        knowledge = MYBRICKS_KNOWLEDGES_MAP[component.toUpperCase()];
      } else if (source === "html") {
        knowledge = HTML_KNOWLEDGES_MAP[component.toUpperCase()];
      } else if (source === "@ant-design/icons") {
        knowledge = ANTD_ICONS_KNOWLEDGES_MAP[component.toUpperCase()];
      }

      if (knowledge?.editors) {
        const cn = `.${className[0]}`;
        const valueProxy = genStyleValue({ comId: props.model?.runtime?.id || props.id, id: props.id });
        const allItems: any[] = [];

        Object.keys(knowledge.editors).forEach((key) => {
          const editor = knowledge.editors[key];

          if (key === ':root') {
            if (className.length > 1) {
              // runtime 多类名场景（激活态、禁用态等），每个类名对应一个分类
              className.forEach((cls, index) => {
                allItems.push({
                  title: "样式",
                  catelog: getCatelogName(cls, index),
                  autoOptions: true,
                  valueProxy,
                  target: `.${cls}`,
                });
              });
            } else if (editor.style) {
              // knowledge 中有自定义样式配置时，按配置展开
              editor.style.forEach((styleGroup: any) => {
                styleGroup.items?.forEach((item: any) => {
                  allItems.push({ ...item, valueProxy });
                });
              });
            } else {
              // 兜底：通用自动样式
              allItems.push({ title: '样式', autoOptions: true, valueProxy });
            }

            // 从 styleSource 中提取用户手写的伪类选择器（如 .btn:hover, .btn:focus）
            if (data.styleSource) {
              extractPseudoSelectors(data.styleSource, cn).forEach(({ selector, catelog }) => {
                allItems.push({
                  title: "样式",
                  catelog,
                  autoOptions: true,
                  valueProxy,
                  target: `.${id} ${selector}`,
                });
              });
            }
          } else {
            // 非 :root 状态选择器（如 .ant-btn:hover），以 target 字段合并进根选区
            editor.style?.forEach((styleGroup: any) => {
              styleGroup.items?.forEach((item: any) => {
                allItems.push({ ...item, valueProxy, target: key });
              });
            });
          }
        });

        // 创建或更新根选区
        const rootEditor = knowledge.editors[':root'];
        if (!focusAreaConfigs[cn]) {
          focusAreaConfigs[cn] = {
            title: rootEditor?.title || cn,
            items: [genLayoutEditor(cn), genResizer()],
            style: [{ items: allItems }, genResizer()],
          };
        } else {
          const existing = focusAreaConfigs[cn];
          existing.items = existing.items || [];
          if (!existing.items.some((item: any) => item.type === '_resizer')) {
            existing.items.push(genResizer());
          }
          if (!existing.items.some((item: any) => item.type === 'layout')) {
            existing.items.push(genLayoutEditor(cn));
          }
          existing.style = [{ items: allItems }, genResizer()];
        }
      }
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

  context.setAiComParams(props.id, props);

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
    /** 初始化 */
    // '@init': () => {},
    /** 保存的回调 */
    // '@save'() {},
    /** toJSON的回调 */
    // '@toJSON'(){},
  }
}