import React, { useEffect, useMemo, useRef } from "react";
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

  /** 渲染运行时错误视图（由父组件提供，对应 RuntimeErrorView） */
  renderRuntimeError?: (props: { title: string; desc: string; errors: any[]; comId?: string }) => React.ReactNode

  /** 是否在 mybricks geo webview 中 */
  inMybricksGeoWebview?: boolean
  /** 运行模式标识（由外层 runtime-card 计算并写入 data.runtimeMode，快照用于 Agent） */
  runtimeMode?: string
}

interface BootstrapProps {
  id: string
  env: AIJsxRuntimeParams['env']
  data: any
  dependencies: Record<string, any>
  logger: any
  cssApi: { set: (args: { fileName: string; content: string; old?: boolean }) => void }
  placeholder: React.ReactNode
  activeEnv: string
  runtimeMode: string
  renderRuntimeError?: (props: { title: string; desc: string; errors: any[]; comId?: string }) => React.ReactNode
}

/**
 * BootstrapReactComponent：所有初始化逻辑（eval + activate + getModule + 渲染）都在这里。
 *
 * 置于 ErrorBoundary 内部，任何阶段 throw 的错误都由 ErrorBoundary.componentDidCatch 统一捕获，
 * 无需手动 try/catch + 写 data._errors。
 */
const BootstrapReactComponent = ({ id, env, data, dependencies, logger, cssApi, placeholder, renderRuntimeError, activeEnv, runtimeMode }: BootstrapProps) => {
  const envRunnerRef = useRef<any>(null);

  // 所有初始化：eval dataSource.js → eval setup.js → build FilesModule → getModule('index.jsx')
  // 任何一步 throw，ErrorBoundary 捕获，渲染 RuntimeErrorView
  const initErrorRef = useRef<Error | null>(null);

  const ReactComponent = useMemo(() => {
    initErrorRef.current = null;
    try {
    const mybricks = createMyBricks({ comId: id, runtimeMode, logger, env, data });
    const collectDebugLogs = (mybricks as any)._collectDebugLogs;

    // 包装 DataSource：通过 Proxy 拦截用户子类实例的所有方法调用，将调用记录写入 debugLogs
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

    // 创建独立的 EnvRunner 实例，每次 useMemo 重建天然隔离
    const envRunner = createEnvRunner();
    envRunnerRef.current = envRunner;
    const mybricksTesting = {
      describe: envRunner.describe.bind(envRunner),
      spyOn: envRunner.spyOn.bind(envRunner),
    };

    // 1. eval dataSource.js，直接 throw → ErrorBoundary 捕获
    let dataSourceInstance: any = null;
    const dsFile = (data.files as any[]).find(f => f.fileName === 'dataSource.js');
    if (dsFile?.compiled) {
      const exports: any = { default: null };
      const wrapCode = `(function(exports,require){${decodeURIComponent(dsFile.compiled)}})`;
      eval(wrapCode)(exports, (pkg: string) => pkg === 'mybricks' ? mybricksWithDataSource : undefined);
      dataSourceInstance = exports.default;
    }

    // 2. eval setup.js，直接 throw → ErrorBoundary 捕获
    if (dataSourceInstance) {
      const setupFile = (data.files as any[]).find(f => f.fileName === 'setup.js');
      if (setupFile?.compiled) {
        const dsExportForSetup = { default: dataSourceInstance, __esModule: true };
        const wrapCode = `(function(exports,require){${decodeURIComponent(setupFile.compiled)}})`;
        eval(wrapCode)({ default: null }, (pkg: string) => {
          if (pkg === 'mybricks/testing') return mybricksTesting;
          if (pkg === 'dataSource' || pkg === './dataSource') return dsExportForSetup;
          return undefined;
        });
        // 收集 describe 注册的所有环境名，供 @debug 钩子返回给搭建态展示
        if (!env.runtime) {
          data._debugEnvs = envRunner.getEnvNames();
        }
        envRunner.activate(activeEnv);
      }
    }

    // 3. 构建 FilesModule，将 dataSource 单例注入为具名依赖
    const dsExport = dataSourceInstance ? { default: dataSourceInstance, __esModule: true } : null;
    const dataSourceDeps: Record<string, any> = {};
    if (dsExport) {
      dataSourceDeps['dataSource'] = dsExport;
      const allFiles: string[] = (data.files as any[]).map(f => f.fileName);
      allFiles.forEach(f => {
        const depth = f.split('/').length - 1;
        if (depth === 0) {
          dataSourceDeps['./dataSource'] = dsExport;
        } else {
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
        less({ fileName, content, old }) {
          cssApi.set({ fileName, content, old });
        }
      }
    });

    // 4. getModule('index.jsx')
    return fm.getModule('index.jsx')?.default;
    } catch (e: any) {
      initErrorRef.current = e;
      return undefined;
    }
  }, []);

  if (initErrorRef.current) {
    const e = initErrorRef.current;
    const title = '组件运行时错误';
    const desc = (e as any)?.message || String(e);
    if (renderRuntimeError) {
      return <>{renderRuntimeError({ title, desc, errors: [{ message: desc, type: 'runtime' }] })}</>;
    }
    return <div style={{ color: 'red', padding: 8 }}>{desc}</div>;
  }

  if (typeof ReactComponent !== 'function') {
    const CustomView = typeof window !== 'undefined' && (window as any)._renderCompView_;
    if (CustomView) {
      if (typeof CustomView === 'function') return <CustomView />;
      if (React.isValidElement(CustomView)) return CustomView;
    }
    return <>{placeholder}</>;
  }

  return <ReactComponent />;
};

const AIJsxRuntime = (params: AIJsxRuntimeParams) => {
  const {
    id,
    env,
    data,
    dependencies,
    placeholder,
    logger,
    renderRuntimeError,
    runtimeMode: externalRuntimeMode,
  } = params;
  const cssApi = useCssApi({ id, env });

  const activeEnv = useMemo(() => {
    return env.edit ? 'mock' : (data._activeDebugEnv ?? 'prod');
  }, [data._activeDebugEnv, env.edit])

  // 若外层已传入 runtimeMode（runtime-card），直接使用；否则内部计算兜底
  const runtimeMode = externalRuntimeMode ?? (env.edit ? `${id}_edit` : `${id}_runtime_${activeEnv}`);

  useEffect(() => {
    return () => {
      // 切换搭建/调试态，重置，默认就是走线上
      data._activeDebugEnv = 'prod'
    }
  }, [])

  return (
    <ErrorBoundary data={data} renderRuntimeError={renderRuntimeError} comId={id}>
      <BootstrapReactComponent
        id={id}
        key={runtimeMode}
        env={env}
        data={data}
        activeEnv={activeEnv}
        runtimeMode={runtimeMode}
        dependencies={dependencies}
        logger={logger}
        cssApi={cssApi}
        placeholder={placeholder}
        renderRuntimeError={renderRuntimeError}
      />
    </ErrorBoundary>
  );
};

export { AIJsxRuntime }
export type { AIJsxRuntimeParams }
