import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useReducer, useCallback } from 'react';
import css from './mybricks-lib.less';

// --- Store 相关：符号与响应式封装 ---

export const SYMBOL_SETLISTENER = Symbol('setListener');
export const SYMBOL_SUBSCRIBE = Symbol('subscribe');
export const SYMBOL_GETSNAPSHOT = Symbol('getSnapshot');

/**
 * 模块级当前 key 收集器，类似 Vue3 的 activeEffect。
 * 方法执行期间，boundContext 的 get 会向此回调上报读取的 key。
 */
let currentKeyCollector: ((key: string) => void) | null = null;

class DefaultStore {}

/**
 * 根据用户 store.js 的 Store 类生成带监听能力的 store，供 createMybricks 使用。
 * design 模式下 store 上的方法不执行，返回空函数。
 */
export function genListenersStore(
  StoreClass: any,
  options: { mode: 'design' | 'runtime' }
) {
  const { mode } = options;
  const listenersMap = new Map();
  let store: any;
  try {
    store = StoreClass ? new StoreClass() : new DefaultStore();
  } catch (error) {
    store = new DefaultStore();
    console.error('store创建失败：', error);
  }
  const setListener = (key: string, listener: (arg: { key: string; value: any }) => void) => {
    let listeners = listenersMap.get(key);
    if (!listeners) {
      listeners = new Set();
      listenersMap.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // 共用一个 Proxy 作为方法调用的 this，避免每次 get 方法时都 new Proxy
  // const boundContext =
  //   mode === 'runtime'
  //     ? new Proxy(
  //         {},
  //         {
  //           get(_, k) {
  //             return store[k];
  //           },
  //           set(_, k, v) {
  //             store[k] = v;
  //             const list = listenersMap.get(k);
  //             if (list) {
  //               list.forEach((fn: (arg: { key: string; value: any }) => void) =>
  //                 fn({ key: k as string, value: v })
  //               );
  //             }
  //             return true;
  //           },
  //         }
  //       )
  //     : null;

  const boundContext = new Proxy(
    {},
    {
      get(_, k) {
        // 若当前有活跃的收集器（方法调用中），上报读取的 key
        if (currentKeyCollector && typeof k === 'string') {
          currentKeyCollector(k);
        }
        return store[k];
      },
      set(_, k, v) {
        store[k] = v;
        const list = listenersMap.get(k);
        if (list) {
          list.forEach((fn: (arg: { key: string; value: any }) => void) =>
            fn({ key: k as string, value: v })
          );
        }
        return true;
      },
    }
  )

  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === SYMBOL_SETLISTENER) {
          return setListener;
        }
        const value = store[key];
        if (typeof value === 'function') {
          // if (mode === 'design') {
          //   return () => {};
          // }
          return value.bind(boundContext);
        }
        return store[key];
      },
    }
  );
}

/**
 * 响应式 Store 封装：对 genListenersStore 返回的 store 做 subscribe/getSnapshot，供 useSyncExternalStore 使用。
 */
function createReactiveStore(store: any) {
  const state: Record<string, any> = {};
  let snapshot: Record<string, any> = {};
  let dirty = false;
  const collectionsListener = new Map<string, () => void>();
  const listeners = new Set<() => void>();

  const subscribe = (callback: () => void) => {
    listeners.add(callback);
    return () => {
      collectionsListener.forEach((destroy) => destroy());
      listeners.delete(callback);
    };
  };

  // 仅在 getSnapshot 被调用时做一次浅拷贝，避免每次 set 都全量展开 state；同帧多次 set 只触发一次拷贝
  const getSnapshot = () => {
    if (dirty) {
      snapshot = Object.assign({}, state);
      dirty = false;
    }
    return snapshot;
  };

  /**
   * 将 key 纳入依赖追踪：首次遇到该 key 时注册监听。
   */
  const trackKey = (key: string) => {
    if (collectionsListener.has(key)) return;
    const collectionListener = ({ key: k, value: v }: { key: string; value: any }) => {
      state[k] = v;
      dirty = true;
      listeners.forEach((listener) => listener());
    };
    collectionsListener.set(key, store[SYMBOL_SETLISTENER](key, collectionListener));
  };

  return new Proxy({} as any, {
    get(_target, key) {
      if (key === SYMBOL_SUBSCRIBE) return subscribe;
      if (key === SYMBOL_GETSNAPSHOT) return getSnapshot;
      const value = store[key];
      if (typeof value === 'function') {
        // 包装函数：执行期间开启 key 收集，捕获方法内对 this.xxx 的读取
        return (...args: any[]) => {
          currentKeyCollector = (readKey: string) => trackKey(readKey);
          try {
            return value(...args);
          } finally {
            currentKeyCollector = null;
          }
        };
      }
      // 非函数 key：直接追踪并返回
      trackKey(key as string);
      return value;
    },
  });
}

// --- 路由相关：RouterContext / Route / Routes / hooks / appRef ---
function createRouterLib({
  env,
  _env,
  pageRefRegistry,
  debugTarget,
  data
}: {
  env: any,
  _env: { mode: 'design' | 'runtime' },
  pageRefRegistry: any[],
  debugTarget?: any,
  data?: any
}) {
  const ROUTE_TYPE = Symbol('Route')

  const isDesign = () => {
    return _env.mode === 'design';
  }

  const transformPath = ({ index, path }) => {
    return index ? '/' : (path.startsWith("/") ? path : `/${path}`)
  }

  interface AppContextValue {
    state: 'collect_routes' | 'runtime'
    registerRoute: (route: string) => void
  }
  const AppContext = createContext<AppContextValue>({
    state: 'runtime',
    registerRoute: () => {}
  });

  const createAppRef = (store: any, useSyncExternalStore: any, popupRefRegistry: any[] = []) => {
    return function appRef(Component) {
      return (props) => {
        const autoStore = useRef<any>(null);
        if (!autoStore.current) {
          autoStore.current = createReactiveStore(store);
        }
        const state = useSyncExternalStore(
          autoStore.current[SYMBOL_SUBSCRIBE],
          autoStore.current[SYMBOL_GETSNAPSHOT]
        );

        if (isDesign()) {
          const collectingRoutes = useRef<string[]>([]);

          const [app, setApp] = useState<AppContextValue>({
            state: 'collect_routes',
            registerRoute: (path: string) => {
              collectingRoutes.current.push(path);
            },
          })

          useLayoutEffect(() => {
            setApp((app) => {
              return {
                ...app,
                state: 'runtime'
              }
            })
          }, [])

          return (
            <AppContext.Provider value={app}>
              {app.state === "collect_routes" && (
                <Component
                  {...props}
                  _env={_env}
                  store={autoStore.current}
                  _state={state}
                />
              )}
              {app.state === 'runtime' && (
                collectingRoutes.current.length > 0 ? collectingRoutes.current.map((route) => {
                  return (
                    <Page path={route}>
                      <CollectingRoute
                        {...props}
                        _env={_env}
                        store={autoStore.current}
                        _state={state}
                        _route={route}
                        _Component={Component}
                      />
                    </Page>
                  )
                }) : (
                  <Page path={'/'}>
                    <Route
                      path='/'
                      element={(
                        <Component
                          {...props}
                          _env={_env}
                          store={autoStore.current}
                          _state={state}
                        />
                      )}
                    />
                  </Page>
                )
              )}
              {app.state === 'runtime' && (
                popupRefRegistry.map((DialogRoot, index) => (
                  <DialogRoot key={`dialog-${index}`}/>
                ))
              )}
            </AppContext.Provider>
          )
        }

        return (
          <RuntimeRoute
            {...props}
            _env={_env}
            store={autoStore.current}
            _state={state}
            _route={env._debugTarget.pageIndex}
            _Component={Component}
          />
        )
      }
    }
  }

  type NavigateOptions = {
    replace?: boolean
    state?: unknown
  }
  type NavigateFn = (to: string | number, options?: NavigateOptions) => void
  interface RouterContextValue {
    currentPath: string
    params: Record<string, string>
    navigate: NavigateFn
    locationState: unknown
  }
  const RouterContext = createContext<RouterContextValue>({
    currentPath: '/',
    navigate: () => {},
    locationState: undefined,
    params: {}
  });

  const CollectingRoute = (params: { _route: string, _Component: React.FC<any> }) => {
    const { _route, _Component: Component } = params;
    return (
      <RouterContext.Provider
        value={{
          currentPath: _route,
          navigate: () => {},
          locationState: undefined,
          params: {}
        }}
      >
        <Component {...params}/>
      </RouterContext.Provider>
    )
  }

  const routerReducer = (state, action) => {
    const { stack, cursor } = state
    switch (action.type) {
      case 'PUSH': {
        const next = [...stack.slice(0, cursor + 1), { path: action.to, state: action.state }]
        return { stack: next, cursor: cursor + 1 }
      }
      case 'REPLACE': {
        const next = [...stack]
        next[cursor] = { path: action.to, state: action.state }
        return { stack: next, cursor }
      }
      case 'GO':
        return { stack, cursor: Math.max(0, Math.min(stack.length - 1, cursor + action.delta)) }
      default:
        return state
    }
  }

  const Page = (params: React.PropsWithChildren<{ path?: string }>) => {
    const { path = '/', children } = params;
    const { activeThemeId, themes } = data.themes;
    const theme = themes.find((theme) => theme.id === activeThemeId);

    return (
      <div
        data-zone-type='page'
        data-zone-kind='page'
        data-desn-page={path}
        style={{
          ...(data?.frameStyle?.width
            ? { width: data.frameStyle.width }
            : { minWidth: 1200, width: 'fit-content' }
          ),
          minHeight: 600,
          transform: 'scale(1)',
          height: 'fit-content',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          ...env._debugTarget?.style,
          ...theme?.vars?.reduce((pre, cur) => {
            pre[cur.propertyName] = cur.value;
            return pre;
          }, {})
        }}>
          {children}
      </div>
    )
  }

  const RuntimeRoute = (params: { _route: string, _Component: React.FC<any> }) => {
    const { _route, _Component: Component } = params;
    const [{ stack, cursor }, dispatch] = useReducer(
      routerReducer,
      { stack: [{ path: _route, state: undefined }], cursor: 0 }
    )

    const currentPath = stack[cursor].path

    // navigate 无外部依赖，引用永远稳定，不会触发消费者重渲染
    const navigate = useCallback((to, options: any = {}) => {
      if (typeof to === 'number') dispatch({ type: 'GO', delta: to })
      else if (options.replace) dispatch({ type: 'REPLACE', to, state: options.state })
      else dispatch({ type: 'PUSH', to, state: options.state })
    }, [])

    const locationState = stack[cursor].state

    const contextValue = useMemo<RouterContextValue>(
      () => ({ currentPath, params: {}, navigate, locationState }),
      [currentPath, navigate, locationState]
    )

    return (
      <div className={css.routesRuntime} style={{...debugTarget?.rootStyle}}>
        <Page>
          <RouterContext.Provider value={contextValue}>
            <Component {...params}/>
          </RouterContext.Provider>
        </Page>
      </div>
    )
  }

  const Routes = (params: React.PropsWithChildren) => {
    const { children } = params;
    const appCtx = useContext(AppContext);
    if (appCtx.state === 'collect_routes') {
      React.Children.forEach(children, (child) => {
        if (React.isValidElement(child) && (child.type as any).__type === ROUTE_TYPE) {
          const { path, index } = child.props;
          appCtx.registerRoute(transformPath({ index, path }));
        }
      });
    }

    return children;
  }

  const Route = (params: { index?: number; path: string; element: React.ReactElement}) => {
    const { index, path, element } = params;
    const appContext = useContext(AppContext)
    const routerContext = useContext(RouterContext)

    if (appContext.state === 'collect_routes') {
      return element
    } else if (index || path) {
      const currentPath = transformPath({ index: null, path: routerContext.currentPath })
      const propPath = transformPath({ index, path })

      if (currentPath === propPath) {
        return element;
      }
    }

    return null
  }

  Route.__type = ROUTE_TYPE

  const useLocation = (): { pathname: string; state: unknown } => {
    const ctx = useContext(RouterContext)
    if (!ctx) throw new Error('useLocation must be used within a <Routes>')
    return { pathname: ctx.currentPath, state: ctx.locationState }
  }

  const useNavigate = (): NavigateFn => {
    const ctx = useContext(RouterContext)
    if (!ctx) throw new Error('useNavigate must be used within a <Routes>')
    return ctx.navigate
  }

  const useParams = (): Record<string, string> => {
    const ctx = useContext(RouterContext)
    if (!ctx) throw new Error('useParams must be used within a <Routes>')
    return ctx.params
  }

  return { createAppRef, Routes, Route, useLocation, useNavigate, useParams }

  // return { Route, Routes, createAppRef, redirect, useNavigate, useLocation, useParams };
}

// --- mybricks 主入口 ---

export interface CreateMybricksOptions {
  env: { runtime?: boolean; _debugTarget?: { type: 'page'; pageIndex: number; style: React.CSSProperties } };
  logger: any;
  store: any;
  useSyncExternalStore: typeof React.useSyncExternalStore;
  mockData?: Record<string, any>;
  data: any
}

/**
 * 创建 mybricks 库实例，供 AIJsxRuntime 注入到用户 runtime.jsx 的 require('mybricks')。
 * 作用域限定在单个 AIJsxRuntime 内（含 RouterContext）。
 */
export function createMybricks(options: CreateMybricksOptions) {
  const { env, logger, store, mockData, data, useSyncExternalStore } = options;
  const _env = {
    mode: (env.runtime ? 'runtime' : 'design') as 'design' | 'runtime',
  };

  /**
   * 页面调试模式：指定要单独渲染的页面索引（仅在 runtime 态生效）。
   * undefined 表示不限制（正常渲染所有页面或走 appRef 路由）。
   */
  const debugTarget: any =
    env.runtime && env._debugTarget !== undefined ? env._debugTarget : undefined;

  // 将当前模式写入 data._designerState，供 Agent 实时读取
  if (data) {
    if (!data._designerState) data._designerState = { pages: [], popups: [] };
    data._designerState.mode = debugTarget ? 'debug' : _env.mode; // 'design' | 'runtime' | 'debug'
  }

  /**
   * pageRef 注册表：按声明顺序收集所有 pageRef 包装后的组件。
   * 在模块 eval 阶段（pageRef 调用时）填充，在 appRef 设计态渲染时消费。
   * 每次 createMybricks 调用时重新创建，天然隔离（无跨 eval 污染）。
   */
  const pageRefRegistry: any[] = [];

  /**
   * popupRef 注册表：收集所有 popupRef 包装后的根节点组件。
   * 在 appRef 渲染时与 pageRef 同级挂载到根节点下。
   */
  const popupRefRegistry: any[] = [];
  const popupRefOriginalsSet = new Set<any>();

  const routerLib = createRouterLib({_env, env, pageRefRegistry, debugTarget, data});

  const wrapWithStore = (Component: any) => {
    return (props: any) => {
      const autoStore = useRef<any>(null);
      if (!autoStore.current) {
        autoStore.current = createReactiveStore(store);
      }
      const state = useSyncExternalStore(
        autoStore.current[SYMBOL_SUBSCRIBE],
        autoStore.current[SYMBOL_GETSNAPSHOT]
      );
      return (
        <Component
          {...props}
          _env={_env}
          store={autoStore.current}
          _state={state}
        />
      );
    };
  };

  const wrapDialogWithStore = (Component: any) => {
    // 注册到 popupRefRegistry，在 appRef 根节点与 pageRef 同级渲染
    const dialogIndex = pageRefRegistry.length + popupRefRegistry.length;

    const DialogRoot = (props) => {
      const autoStore = useRef<any>(null);
      if (!autoStore.current) {
        autoStore.current = createReactiveStore(store);
      }
      const state = useSyncExternalStore(
        autoStore.current[SYMBOL_SUBSCRIBE],
        autoStore.current[SYMBOL_GETSNAPSHOT]
      );

      const { activeThemeId, themes } = data.themes;
      const theme = themes.find((theme) => theme.id === activeThemeId);

      if (_env.mode === "design") {
        const containerRef = useRef<HTMLDivElement>(null);
        const [container, setContainer] = useState<HTMLDivElement | null>(null);

        useLayoutEffect(() => {
          setContainer(containerRef.current!)
        }, [])
        return (
          <div
            ref={containerRef}
            data-zone-type="page"
            data-zone-kind="popup"
            data-desn-page={dialogIndex}
            style={{
              ...(data?.frameStyle?.width
                ? { width: data.frameStyle.width }
                : { minWidth: 1200, width: 'fit-content' }
              ),
              minHeight: 2000,
              display: 'inline-block',
              transform: 'scale(1)',
              height: 'fit-content',
              ...env._debugTarget?.style,
              ...theme?.vars?.reduce((pre, cur) => {
                pre[cur.propertyName] = cur.value;
                return pre;
              }, {})
            }}>
            {container && <Component
              {...props}
              _env={_env}
              store={autoStore.current}
              _state={state}
              popupNode={container}
              wrapper={container}
            />}
          </div>
        );
      } else {
        const containerRef = useRef<HTMLDivElement>(null);
        const [container, setContainer] = useState<any>(false);

        useLayoutEffect(() => {
          const page = containerRef.current?.closest('[data-zone-type="page"]')
          if (page) {
            setContainer(page)
          }
        }, [])
        
        return (
          <>
            <div ref={containerRef} />
            {container && <Component
              {...props}
              _env={_env}
              store={autoStore.current}
              _state={state}
              popupNode={container}
              wrapper={container}
            />}
          </>
        )
      }
    };

    if (_env.mode === 'design') {
      // 运行态不做任何处理，保留类字段原始初始值
      if (!popupRefOriginalsSet.has(Component)) {
        popupRefOriginalsSet.add(Component);
        popupRefRegistry.push(DialogRoot);
        // 写入 data._designerState.popups
        if (data) {
          if (!data._designerState) data._designerState = { pages: [], popups: [] };
          if (!data._designerState.popups.includes(Component.name)) {
            data._designerState.popups.push(Component.name);
          }
        }
      }
      return () => null;
    }

    return DialogRoot
  };

  /**
   * 浮层类组件在设计态默认展开
   */
  const PopupVisible = (target, propertyKey) => {
    if (_env.mode !== 'design') {
      // 运行态不做任何处理，保留类字段原始初始值
      return;
    }
    // 设计态：强制初始值为 true 且不允许修改（setter 静默忽略赋值，避免严格模式报错）
    return {
      enumerable: true,
      configurable: true,
      get() {
        return true;
      },
      set() { 
        return false;
      },
    };
  }

  return {
    popupRef: wrapDialogWithStore,
    comRef: wrapWithStore,
    pageRef: wrapWithStore,
    appRef: routerLib.createAppRef(store, useSyncExternalStore, popupRefRegistry),
    Routes: routerLib.Routes,
    Route: routerLib.Route,
    useNavigate: routerLib.useNavigate,
    useLocation: routerLib.useLocation,
    useParams: routerLib.useParams,
    createEnvs,
    createAPI: mockData ? (config) => {
      return () => {
        return Promise.resolve(mockData[config.url]);
      }
    } : createAPI,
    logger,
    PopupVisible
  };
}

// --- 接口相关：createEnvs / createAPI ---

type EnvConfig = { title?: string; baseUrl: string; [key: string]: any };

/** 当前激活的 axios 实例，由 createEnvs 注册，由 createAPI 消费 */
const envInstances: Record<string, any> = {};
let currentEnvKey: string | null = null;

function getCurrentInstance() {
  if (currentEnvKey && envInstances[currentEnvKey]) {
    return envInstances[currentEnvKey];
  }
  const keys = Object.keys(envInstances);
  if (keys.length > 0) {
    return envInstances[keys[0]];
  }
  // 未注册任何环境时降级：直接用 fetch 包一层，保持接口可用
  return (config: any) => {
    const { method = 'GET', url, params, data: body, headers } = config;
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetch(`${url}${query}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());
  };
}

/**
 * 注册多套环境实例（本质是 axios.create）。
 * 在 service.js 顶层调用，不在 store 中调用。
 */
export function createEnvs(envConfigs: Record<string, EnvConfig>) {
  const axiosLib = typeof window !== 'undefined' ? (window as any).axios ?? null : null;
  Object.entries(envConfigs).forEach(([key, { title: _title, baseUrl, ...rest }]) => {
    if (axiosLib) {
      const axiosInstance = axiosLib.create({ baseURL: baseUrl, ...rest });
      // axios 返回的是 { data, status, headers... }，统一解析出 data 返回
      envInstances[key] = (config: any) =>
        axiosInstance(config).then((res: any) => res?.data ?? res);
    } else {
      // window.axios 不存在时的轻量 fetch 适配器
      envInstances[key] = (config: any) => {
        const { method = 'GET', url: path = '', params, data: reqBody, headers: reqHeaders } = config;
        const fullUrl = baseUrl.replace(/\/$/, '') + path;
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return fetch(`${fullUrl}${query}`, {
          method,
          headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}), ...reqHeaders },
          body: reqBody != null ? JSON.stringify(reqBody) : undefined,
        }).then((r) => r.json());
      };
    }
    if (currentEnvKey === null) currentEnvKey = key;
  });
}

/**
 * 定义一个接口函数，调用时合并配置并用当前环境实例发请求。
 * defaultConfig 中 method、url、summary 为必填。
 * 在 service.js 中调用，不在 store 中调用。
 */
export function createAPI(
  defaultConfig: { method: string; url: string; summary: string; [key: string]: any },
  paramsMapper?: (params: any) => any
) {
  return (params?: any) => {
    const runtimeConfig = paramsMapper ? paramsMapper(params) : {};
    return getCurrentInstance()({ ...defaultConfig, ...runtimeConfig });
  };
}
