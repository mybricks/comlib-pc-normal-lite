import React, {useEffect, useMemo, useState, Component, ReactElement, cloneElement, useRef} from 'react';
import css from './index.less'
import dayjs from "dayjs";


interface CssApi {
  set: (id: string, content: string) => void
  remove: (id: string) => void
}

interface ErrorInfo {
  title: string,
  desc?: string
}

const ErrorTip = ({ title, desc }: ErrorInfo) => {
  return <div className={css.error}>
    <div className={css.title}>{title}</div>
    <div className={css.desc}>{desc}</div>
  </div>
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
  }

  state = {
    error: null,
    errorInfo: null
  };

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
  }

  render() {
    // @ts-ignore
    const errorTip = this.state?.error?.toString ? this.state.error.toString() : (this.state.errorInfo ? this.state.errorInfo.componentStack : null);
  
    if (errorTip) {
      return <ErrorTip title={'组件渲染错误'} desc={errorTip} />
    }

    // @ts-ignore
    return this.props.children; 
  }
}

interface AIJsxProps {
  id: string,
  env: any,
  /** style 代码 */
  styleCode?: string,
  /** jsx 代码 */
  renderCode: string,
  /** AI组件props */
  renderProps: Record<string, any>,
  /** 报错信息 */
  errorInfo?: ErrorInfo,
  /** 占位组件 */
  placeholder?: string | ReactElement
  /**  依赖组件信息 */
  dependencies?: Record<string, any>
  /** 是否在引擎环境 */
  inMybricksGeoWebview: boolean;
  data: any;
  inputs: any;
  outputs: any;
}

const STYLE_REPLACE_ID = '__mybricks_ai_module_id__'

export const AIJsxRuntime = ({ id, env, styleCode, renderCode, data, inputs, outputs, errorInfo, placeholder = 'AI组件', dependencies = {}, inMybricksGeoWebview } : any) => {
  const ref = useRef<any>(null);
  const appendCssApi = useMemo<CssApi>(() => {
    if (inMybricksGeoWebview && env.canvas?.css) {
      const cssAPI = env.canvas.css
      return {
        set(id: string, content: string) {
          const myContent = content.replaceAll(STYLE_REPLACE_ID, id)//替换模版
          cssAPI.set(id, myContent)
        },
        remove() {
          return cssAPI.remove(id)
        }
      }
    }

    return {
      set: (id: string, content: string) => {
        const el = document.getElementById(id);
        if (el) {
          el.innerText = content.replaceAll(STYLE_REPLACE_ID, id)//替换模版
          return
        }
        const styleEle = document.createElement('style')
        styleEle.id = id;
        const myContent = content.replaceAll(STYLE_REPLACE_ID, id)//替换模版
        styleEle.innerText = myContent
        document.head.appendChild(styleEle);
      },
      remove: (id: string) => {
        const el = document.getElementById(id);
        if (el && el.parentElement) {
          el.parentElement.removeChild(el)
        }
      }
    }
  }, [env])

  // 注入 CSS 代码
  useMemo(() => {
    if (styleCode) {
      appendCssApi.set(`${id}`, decodeURIComponent(styleCode))
    }
  }, [styleCode, appendCssApi])

  // 卸载 CSS 代码
  // useEffect(() => {
  //   return () => {
  //     // mbcrcss = mybricks_custom_render缩写
  //     appendCssApi.remove(`${id}`)
  //   }
  // }, [])

  const renderProps = useMemo(() => {
    let modelConfig = {};

    try {
      modelConfig = JSON.parse(decodeURIComponent(data.modelConfig));
    } catch {};

    let componentConfig = {
      inputs: [],
      outputs: []
    };

    try {
      componentConfig = JSON.parse(decodeURIComponent(data.componentConfig));
    } catch {};

    componentConfig.inputs?.forEach((input: any) => {
      inputs[input.id]((value) => {
        ref.current[input.id](value);
      })
    })

    return {
      ...modelConfig,
      ...componentConfig.outputs?.reduce((pre: any, cur: any) => {
        pre[cur.id] = (value) => {
          outputs[cur.id](value);
        }
        return pre;
      }, {})
    }
  }, [data.runtimeJsxCompiled, data.modelConfig])

  const ReactNode = useMemo(() => {
    if (errorInfo) return () => <ErrorTip title={errorInfo.title} desc={errorInfo.desc} />;
    if (renderCode) {
      try {
        const oriCode = decodeURIComponent(renderCode);

        const Com: any = runRender(oriCode, {
          'react': React,
          'mybricks': env.mybricksSdk,
          'dayjs': dayjs,
          ...dependencies,
        })
        // TODO 没有key的话会用预览的高度
        return (props) => cloneElement(<Com ref={ref} {...props} />, {}, null);


        // let RT = window[`mbcrjsx_${id}`]

        // if (!RT.default) {
        //   throw new Error('未导出组件定义')
        // }
        // RT = RT.default
        // // return (props) => {
        // //   return <ErrorBoundary><RT {...props}></RT></ErrorBoundary>
        // // };
        // return (props) => {
        //   return <RT {...props}></RT>
        // };
      } catch (error) {
        return () => <ErrorTip title={'获取组件定义失败'} desc={error?.toString?.()} />;
      }
    } else {
      return
    }
  }, [renderCode, errorInfo, data.modelConfig])


  if (typeof ReactNode !== 'function') {
    return placeholder
  }

  return <ReactNode {...renderProps} />
}

function runRender(code, dependencies) {
  const wrapCode = `
          (function(exports,require){
            ${code}
          })
        `

  const exports = {
    default: null
  }

  const require = (packageName) => {
    return dependencies[packageName]
  }

  eval(wrapCode)(exports, require)

  return exports.default
}