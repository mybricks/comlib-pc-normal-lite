import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useCssApi } from "./hooks";
import FilesModule from "./FilesModule";
import ErrorBoundary from "./ErrorBoundary";
import { createMyBricks } from "./mybricks";
import { createEnvRunner } from "./mybricks/mybricks-testing";
import { DataSource } from "./mybricks/data-source";

interface AIJsxRuntimeParams {
  /** 组件ID */
  id: string

  /** 引擎注入env */
  env: {
    canvas: {
      css: {
        set: (id: string, content: string) => void
        remove: (id: string) => void
      }
    }
    runtime: boolean
    _debugTarget?: {
        pageIndex: string;
        style: Record<string, any>
    }
  }

  /** 依赖注入 */
  dependencies: Record<string, any>

  /** 数据源 */
  data: {
    /** 文件列表 */
    files: {
      fileName: string
      content: Record<string, any>
    }[]
  }

  /** 提示 */
  placeholder: React.ReactNode

  /** 日志 */
  logger: any
}

const AIJsxRuntime = (params: AIJsxRuntimeParams) => {
  const {
    id,
    env,
    data,
    dependencies,
    placeholder,
    logger
  } = params
  const cssApi = useCssApi({ id, env })

  // 保存 envRunner 实例，供 useEffect 监听 _activeDebugEnv 时重新激活环境
  const envRunnerRef = useRef<any>(null);

  const filesModule = useMemo(() => {
    const mybricks = createMyBricks({
      logger,
      env,
      data
    })

    const collectDebugLogs = mybricks._collectDebugLogs;

    // 包装 DataSource：通过 Proxy 拦截用户子类实例的所有方法调用，将调用记录写入 data._logs
    class DataSourceWithLog extends DataSource {
      constructor() {
        super();
        return new Proxy(this, {
          get(target, key: string) {
            const val = (target as any)[key];
            if (typeof val === 'function' && key !== 'constructor') {
              return (...args: any[]) => {
                const result = val.apply(target, args);
                collectDebugLogs({ type: 'dataSource', method: key, args, result });
                return result;
              };
            }
            return val;
          }
        });
      }
    }

    const mybricksWithDataSource = Object.assign(mybricks, { DataSource: DataSourceWithLog });

    // 创建独立的 EnvRunner 实例，每次 eval 天然隔离
    const envRunner = createEnvRunner();
    // 提升到 ref，供 useEffect 监听 _activeDebugEnv 变化时重新 activate
    envRunnerRef.current = envRunner;
    const mybricksTesting = {
      describe: envRunner.describe.bind(envRunner),
      spyOn: envRunner.spyOn.bind(envRunner),
    };

    // 1. 先独立 eval dataSource.js，得到单例实例
    //    不走 FilesModule 路径解析，确保 setup.js 和 index.jsx 共用同一个实例
    let dataSourceInstance: any = null;
    try {
      const dsFile = (data.files as any[]).find(f => f.fileName === 'dataSource.js');
      if (dsFile?.compiled) {
        const exports: any = { default: null };
        const wrapCode = `(function(exports,require){${decodeURIComponent(dsFile.compiled)}})`
        eval(wrapCode)(exports, (pkg: string) => pkg === 'mybricks' ? mybricksWithDataSource : undefined);
        dataSourceInstance = exports.default;
      }
    } catch (e) {
      console.warn('[AIJsxRuntime] dataSource.js eval 失败', e);
    }

    // 2. eval setup.js，显式注入 dataSource 实例，激活对应环境
    if (dataSourceInstance) {
      try {
        const setupFile = (data.files as any[]).find(f => f.fileName === 'setup.js');
        if (setupFile?.compiled) {
          const dsExportForSetup = { default: dataSourceInstance, __esModule: true };
          const wrapCode = `(function(exports,require){${decodeURIComponent(setupFile.compiled)}})`
          eval(wrapCode)({ default: null }, (pkg: string) => {
            if (pkg === 'mybricks/testing') return mybricksTesting;
            if (pkg === 'dataSource' || pkg === './dataSource') return dsExportForSetup;
            return undefined;
          });
          // 收集 describe 注册的所有环境名，供 @debug 钩子返回给搭建态展示
          if (!env.runtime) {
            data._debugEnvs = envRunner.getEnvNames();
          }
          // 优先用用户上次选择的环境，回退到默认值（设计态 mock，运行态 prod）
          const envToActivate = env.runtime
            ? 'prod'
            : (data._activeDebugEnv ?? 'mock');
          envRunner.activate(envToActivate);
        }
      } catch (e) {
        console.warn('[AIJsxRuntime] setup.js 激活失败', e);
      }
    }

    // 3. 构建 FilesModule，将 dataSource 单例注入为具名依赖，跳过文件路径解析
    //    包装为 { default, __esModule: true }，兼容 import X from 'dataSource' 的 interop
    //    同时注册所有可能的相对路径变体，确保任意深度的文件 require 都命中同一实例
    const dsExport = dataSourceInstance
      ? { default: dataSourceInstance, __esModule: true }
      : null;
    const dataSourceDeps: Record<string, any> = {};
    if (dsExport) {
      // 非相对路径（直接引用）
      dataSourceDeps['dataSource'] = dsExport;
      // 从 filesMap 中推导所有可能的相对路径
      const dsFileName = 'dataSource.js';
      const allFiles: string[] = (data.files as any[]).map(f => f.fileName);
      allFiles.forEach(f => {
        // 对每个文件计算其 require('dataSource.js') 时对应的相对路径 key
        const parts = f.split('/');
        const depth = parts.length - 1; // 该文件所在目录层级
        if (depth === 0) {
          // 根目录文件：'./dataSource' 或 'dataSource'
          dataSourceDeps['./dataSource'] = dsExport;
        } else {
          // 子目录文件：'../../dataSource'（根据深度）
          const ups = Array(depth).fill('..').join('/');
          dataSourceDeps[`${ups}/dataSource`] = dsExport;
        }
      });
    }

    const fm = new FilesModule({
      files: data.files,
      dependencies: Object.assign(dependencies, {
        mybricks: mybricksWithDataSource,
        'mybricks/testing': mybricksTesting,
        ...dataSourceDeps,
      }),
      importCallBack: {
        less({ fileName, content }) {
          cssApi.set({ fileName, content })
        }
      }
    })

    return fm;
  }, [])

  /**
   * 监听 data._activeDebugEnv 变化，重新激活对应环境（无需重新 eval setup.js）。
   * 用户在搭建态通过 @setDebugEnv 切换环境时，engines 会调用 notifyChanged 触发重渲，
   * data._activeDebugEnv 发生变化，此 effect 随即执行，切换 spyOn/axios 配置生效。
   */
  useEffect(() => {
    if (!env.runtime && envRunnerRef.current && data._activeDebugEnv) {
      envRunnerRef.current.activate(data._activeDebugEnv);
    }
  }, [data._activeDebugEnv]);

  /**
   * 监听 data._activeDebugEnv 变化，重新激活对应环境（无需重新 eval setup.js）。
   * 用户在搭建态通过 @setDebugEnv 切换环境时，engines 调用 notifyChanged 触发重渲，
   * data._activeDebugEnv 发生变化，此 effect 随即执行，切换 spyOn/axios 配置生效。
   *
   * 【注意】不能在 useMemo 里切换：useMemo 在第一次渲染时已经 activate 了初始环境，
   * 之后 _activeDebugEnv 变化只会触发 re-render，useMemo([], []) 不会重跑，
   * 必须用 useEffect 监听变化后单独调用 activate。
   */
  useEffect(() => {
    if (!env.runtime && envRunnerRef.current && data._activeDebugEnv) {
      envRunnerRef.current.activate(data._activeDebugEnv);
    }
  }, [data._activeDebugEnv]);

  /**
   * 【重要】eval 失败时招技异常并直接写入 data._errors。
   *
   * 为什么必须在这里 catch：
   *   - eval 在 useMemo 里调用，发生在 React 渲染周期之前（非 JSX render 阶段），
   *     ErrorBoundary.componentDidCatch 只能捕获 render 阶段的异常，
   *     因此 eval 抛出的错误不会被 ErrorBoundary 捕获，必须在此手动写入 data._errors。
   */
  const ReactComponent = useMemo(() => {
    try {
      return filesModule.getModule('index.jsx')
    } catch (e: any) {
      // eval 失败（运行时错误），直接写入 data._errors
      if (data) {
        if (!data._errors) data._errors = [];
        const errorMessage = e?.message || String(e);
        const fileName: string | undefined = e?.fileName;
        data._errors = [
          ...((data._errors as any[]).filter((err: any) => err.file)),
          {
            message: errorMessage,
            type: 'runtime',
            ...(fileName ? { file: fileName } : {}),
          }
        ];
      }
      console.log('data', data._errors)
      return undefined;
    }
  }, [])

  if (typeof ReactComponent !== 'function') {
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
  
  return (
    <ErrorBoundary data={data}>
      <ReactComponent />
    </ErrorBoundary>
  )
}

export { AIJsxRuntime }
export type { AIJsxRuntimeParams }
