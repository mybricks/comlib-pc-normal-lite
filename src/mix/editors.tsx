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

const genStyleValue = (params) => {
  const { comId } = params;
  return {
    set(params, value) {
      const aiComParams = context.getAiComParams(comId);
      const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
      const selector = params.selector;
      const cssObjKey = Object.keys(cssObj).find(key => key.endsWith(selector)) || selector;
  
      if (!cssObj[cssObjKey]) {
        cssObj[cssObjKey] = {};
      }
  
      Object.entries(value).forEach(([key, value]) => {
        cssObj[cssObjKey][key] = value;
      })
  
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

  const { data, isLowCodeMode } = props;
  const focusAreaConfigs: any = {};
  try {
    const configs = evalConfigJsCompiled(decodeURIComponent(data.configJsCompiled));
    const rawConfig = decodeURIComponent(data.modelConfig);
    const model = JSON.parse(rawConfig);

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
          item.valueProxy = genStyleValue({ comId: props.model?.runtime?.id || props.id });
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
      } else if (source === "mybricks") {
        knowledge = MYBRICKS_KNOWLEDGES_MAP[component.toUpperCase()];
      } else if (source === "html") {
        knowledge = HTML_KNOWLEDGES_MAP[component.toUpperCase()];
      } else if (source === "@ant-design/icons") {
        knowledge = ANTD_ICONS_KNOWLEDGES_MAP[component.toUpperCase()];
      }

      if (knowledge?.editors) {
        Object.keys(knowledge.editors).forEach((key) => {
          const editor = knowledge.editors[key];
          const cn = `.${className[0]}`;
          const selector = key === ":root" ? cn : `${cn} ${key}`;
          const items = className.length === 1 ? [
            {
              title: '样式',
              autoOptions: true,
              valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id })
            }
          ] : className.map((className) => {
            const target = key === ":root" ? `.${className}` : `.${className} ${key}`;
            return {
              title: "样式",
              autoOptions: true,
              valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id }),
              target,
            }
          });
          if (!focusAreaConfigs[selector]) {
            focusAreaConfigs[selector] = {
              title: editor.title || cn,
              items: [],
              style: [
                {
                  // items: [
                  //   {
                  //     title: '样式',
                  //     autoOptions: true,
                  //     valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id })
                  //   }
                  // ]
                  items,
                }
              ]
            }
          } else {
            focusAreaConfigs[selector].style = [
              {
                items,
                // items: [
                //   {
                //     title: '样式',
                //     autoOptions: true,
                //     valueProxy: genStyleValue({ comId: props.model?.runtime?.id || props.id })
                //   }
                // ]
              }
            ]
          }

          if (key === ":root") {
            if (!focusAreaConfigs[selector].items) {
              focusAreaConfigs[selector].items = [
                genResizer()
              ]
            } else {
              focusAreaConfigs[selector].items.push(genResizer())
            }
  
            focusAreaConfigs[selector].style.push(genResizer())
          }
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