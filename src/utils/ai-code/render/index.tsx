import React, {useEffect, useMemo, useState, Component, ReactElement, cloneElement, useRef, useSyncExternalStore} from 'react';
import css from './index.less'
import dayjs from "dayjs";
import { createMybricks, genListenersStore } from './mybricks-lib';

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
    hasError: false,
    error: null,
    errorInfo: null
  };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // 添加运行时错误到统一错误列表
    const { data } = this.props as any;
    if (data) {
      if (!data._errors) data._errors = [];
      // 移除旧的运行时错误（没有 file 字段的）
      data._errors = data._errors.filter(err => err.file);
      const errorMessage = error?.toString ? error.toString() : (errorInfo ? errorInfo.componentStack : '未知运行时错误');
      data._errors.push({
        message: errorMessage,
        type: 'runtime'
      });
    }
  }

  componentDidMount() {
    // 组件成功挂载，清除之前的运行时错误
    const { data } = this.props as any;
    if (data && data._errors) {
      data._errors = data._errors.filter(err => err.file);
    }
  }

  componentDidUpdate(prevProps, prevState) {
    // 如果从错误状态恢复（比如重新渲染修复了bug），清除运行时错误
    if (prevState.hasError && !this.state.hasError) {
      const { data } = this.props as any;
      if (data && data._errors) {
        data._errors = data._errors.filter(err => err.file);
      }
    }
    // 如果props变化导致组件成功渲染，也清除运行时错误
    if (!this.state.hasError && prevProps !== this.props) {
      const { data } = this.props as any;
      if (data && data._errors) {
        data._errors = data._errors.filter(err => err.file);
      }
    }
  }

  render() {
    // @ts-ignore
    const errorTip = this.state?.error?.toString ? this.state.error.toString() : (this.state.errorInfo ? this.state.errorInfo.componentStack : null);
  

    console.log('errorTip', errorTip);
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

function evalJSCompiled(code: string, data: any) {
  if (!code) {
    return null;
  }
  const evalStr = `
    let result;
    ${code.replace('export default', 'result =')};
    result;
  `;

  try {
    return eval(evalStr);
  } catch (error) {
    const message = error?.message ?? error?.toString?.() ?? '未知错误';
    console.error('eval执行失败：', error);
    // 添加 store.js 执行错误到统一错误列表（运行时错误，不是编译错误）
    // 编译错误应该在保存时就被 context/index.ts 捕获了
    if (!data._errors) data._errors = [];
    // 移除旧的 store.js 运行时错误（保留编译错误）
    data._errors = data._errors.filter(err => !(err.file === 'store.js' && err.type === 'runtime'));
    data._errors.push({
      file: 'store.js',
      message: `Store 执行失败: ${message}`,
      type: 'runtime'  // 这是运行时错误，不是编译错误
    });
    return null;
  }
}

const STYLE_REPLACE_ID = '__mybricks_ai_module_id__'

const PRIVATE_DEPENDENCIES = {
  'style.less': {
    __esModule: true,
    default: new Proxy({}, { get(target, key) { return key } })
  },
  './style.less': {
    __esModule: true,
    default: new Proxy({}, { get(target, key) { return key } })
  }
}

export const AIJsxRuntime = ({ id, env, styleCode, renderCode, data, inputs, outputs, errorInfo, placeholder = 'AI组件', renderError, dependencies = {}, inMybricksGeoWebview, logger } : any) => {
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
        const storeCode = evalJSCompiled(decodeURIComponent(data.storeJsCompiled), data);

        const Com: any = runRender(oriCode, {
          'react': React,
          'mybricks': createMybricks({
            env,
            logger,
            store: genListenersStore(storeCode, { mode: env.runtime ? 'runtime' : 'design' }),
            useSyncExternalStore,
          }),
          'dayjs': dayjs,
          ...PRIVATE_DEPENDENCIES,
          ...dependencies,
        })
        
        // 组件定义成功获取，清除之前的运行时错误（如果有的话）
        // 注意：实际的运行时渲染错误会在 ErrorBoundary 中捕获
        if (data._errors) {
          data._errors = data._errors.filter(err => err.file || err.type !== 'runtime');
        }
        
        // TODO 没有key的话会用预览的高度
        return (props) => <ErrorBoundary data={data}><Com ref={ref} {...props} /></ErrorBoundary>;


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
        // 捕获组件定义获取失败的错误
        if (!data._errors) data._errors = [];
        data._errors = data._errors.filter(err => err.type !== 'runtime' || err.file);
        data._errors.push({
          message: `获取组件定义失败: ${error?.toString?.() ?? '未知错误'}`,
          type: 'runtime'
        });
        return () => <ErrorTip title={'获取组件定义失败'} desc={error?.toString?.()} />;
      }
    } else {
      return
    }
  }, [renderCode, errorInfo, data.modelConfig, data.storeJsCompiled])


  if (typeof ReactNode !== 'function') {
    const CustomView = typeof window !== 'undefined' && (window as any)._renderCompView_;
    if (CustomView) {
      if (typeof CustomView === 'function') {
        return <CustomView />;
      }
      if (React.isValidElement(CustomView)) {
        return CustomView;
      }
    }
    return placeholder;
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