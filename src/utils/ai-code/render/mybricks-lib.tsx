import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import css from './mybricks-lib.less';

// --- Store 相关：符号与响应式封装 ---

export const SYMBOL_SETLISTENER = Symbol('setListener');
export const SYMBOL_SUBSCRIBE = Symbol('subscribe');
export const SYMBOL_GETSNAPSHOT = Symbol('getSnapshot');

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
  const boundContext =
    mode === 'runtime'
      ? new Proxy(
          {},
          {
            get(_, k) {
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
      : null;

  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === SYMBOL_SETLISTENER) {
          return setListener;
        }
        const value = store[key];
        if (typeof value === 'function') {
          if (mode === 'design') {
            return () => {};
          }
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

  return new Proxy({} as any, {
    get(_target, key) {
      if (key === SYMBOL_SUBSCRIBE) return subscribe;
      if (key === SYMBOL_GETSNAPSHOT) return getSnapshot;
      const value = store[key];
      if (!collectionsListener.has(key as string)) {
        const collectionListener = ({ key: k, value: v }: { key: string; value: any }) => {
          state[k] = v;
          dirty = true;
          listeners.forEach((listener) => listener());
        };
        collectionsListener.set(
          key as string,
          store[SYMBOL_SETLISTENER](key, collectionListener)
        );
      }
      return value;
    },
  });
}

// --- 路由匹配（参考 react-router v6 评分规则） ---

type RouteElement = React.ReactElement<{ index?: boolean; path?: string; element: React.ReactNode }>;

/** 去掉首尾多余的 / */
function normalizePath(p: string): string {
  return p.replace(/^\/+|\/+$/g, '');
}

/**
 * 对单段 pattern 与实际 segment 计算匹配分数：
 *   静态段完全相同 → 10
 *   动态段 :param  →  9
 *   通配符 *       →  2
 *   不匹配         → -1
 */
function segmentScore(patternSeg: string, pathSeg: string): number {
  if (patternSeg === pathSeg) return 10;
  if (patternSeg.startsWith(':')) return 9;
  if (patternSeg === '*') return 2;
  return -1;
}

/**
 * 计算 route pattern 对 path 的匹配分数，不匹配返回 -1。
 * 支持：静态路径、:param 动态段、末尾 * 通配、纯 * 兜底
 */
function scoreRoute(pattern: string, path: string): number {
  const normPattern = normalizePath(pattern);
  const normPath = normalizePath(path);

  // 纯 * 兜底，匹配一切
  if (normPattern === '*') return 0;

  const patternSegs = normPattern ? normPattern.split('/') : [];
  const pathSegs = normPath ? normPath.split('/') : [];
  const lastSeg = patternSegs[patternSegs.length - 1];

  if (lastSeg === '*') {
    // 前缀 + 末尾通配，例如 users/*
    const prefixSegs = patternSegs.slice(0, -1);
    if (pathSegs.length < prefixSegs.length) return -1;
    let score = 1; // 末尾 * 贡献 1 分（低于精确匹配）
    for (let i = 0; i < prefixSegs.length; i++) {
      const s = segmentScore(prefixSegs[i], pathSegs[i]);
      if (s < 0) return -1;
      score += s;
    }
    return score;
  }

  // 必须段数完全一致（精确 / 动态）
  if (patternSegs.length !== pathSegs.length) return -1;

  let score = 0;
  for (let i = 0; i < patternSegs.length; i++) {
    const s = segmentScore(patternSegs[i], pathSegs[i]);
    if (s < 0) return -1;
    score += s;
  }
  return score;
}

/**
 * 在 routes 数组中找到与 currentPath 匹配分数最高的索引。
 * index 路由仅匹配空路径，优先级相当于完整静态匹配。
 * 无任何匹配时返回 -1。
 */
function findBestRouteIndex(routes: RouteElement[], currentPath: string): number {
  const normPath = normalizePath(currentPath);
  let bestIdx = -1;
  let bestScore = -1;

  routes.forEach((r, i) => {
    let score: number;
    if (r.props.index) {
      // index 只匹配空路径
      score = normPath === '' ? 10 : -1;
    } else {
      score = scoreRoute(r.props.path ?? '', normPath);
    }
    if (score >= 0 && score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });

  return bestIdx;
}

/**
 * 根据路由 pattern（含 :id 动态段）与实际 path 解析出 params。
 * index 或空 pattern 返回 {}；段数不一致返回 {}。
 */
function parseParams(pattern: string, path: string): Record<string, string> {
  const normPattern = normalizePath(pattern);
  const normPath = normalizePath(path);
  if (!normPattern || normPattern === '*') return {};
  const patternSegs = normPattern.split('/');
  const pathSegs = normPath.split('/');
  // 去掉末尾 * 再比段数
  const last = patternSegs[patternSegs.length - 1];
  const prefixSegs = last === '*' ? patternSegs.slice(0, -1) : patternSegs;
  const pathPrefixSegs = last === '*' ? pathSegs.slice(0, prefixSegs.length) : pathSegs;
  if (prefixSegs.length !== pathPrefixSegs.length) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < prefixSegs.length; i++) {
    const p = prefixSegs[i];
    if (p.startsWith(':')) {
      out[p.slice(1)] = pathPrefixSegs[i];
    }
  }
  return out;
}

// --- 路由相关：RouterContext / Route / Routes / hooks / appRef ---

export interface RouterContextValue {
  currentPath: string;
  _env: { mode: 'design' | 'runtime' };
  /** 编程式跳转；字符串为路径；数字暂不支持历史栈，调用无效果 */
  navigate?: (to: string | number, options?: { replace?: boolean }) => void;
  /** 当前激活 Route 解析出的动态参数 */
  params?: Record<string, string>;
}

/**
 * 创建当前 AIJsxRuntime 实例专属的路由 API。
 * 路由状态用 useState 管理，与业务 store 完全解耦。
 * 每次调用返回新的 RouterContext，作用域限定在一个 AIJsxRuntime 内。
 * pageRefRegistry：由 createMybricks 注入，收集所有 pageRef 注册的组件，供设计态渲染。
 */
function createRouterLib(
  _env: { mode: 'design' | 'runtime' },
  pageRefRegistry: any[],
  debugTarget?: any
) {
  const debugPageIndex = debugTarget?.pageIndex;
  const RouterContext = createContext<RouterContextValue | null>(null);

  /** 稳定容器，持有 appRef 挂载后的 setCurrentPath，避免渲染期间副作用 */
  const setterRef: { current: ((p: string) => void) | null } = { current: null };

  /**
   * 页面调试时，由 Routes 首次渲染填充目标页对应的路由路径。
   * null  = 尚未检测（Routes 还没渲染过）
   * ''    = 目标页不在任何 Route 声明中
   * other = 找到的路径，供 createAppRef 的 useLayoutEffect 跳转
   */
  const debugInitialPathRef: { current: string | null } = { current: null };

  /** 跳转路由：runtime 下切换当前展示的 Route；design 下无效 */
  const redirect = (path: string) => {
    setterRef.current?.(normalizePath(path));
  };

  const navigateImpl = (to: string | number, _options?: { replace?: boolean }) => {
    if (typeof to === 'string') {
      setterRef.current?.(normalizePath(to));
    }
  };

  function Route(_props: { index?: boolean; path?: string; element: React.ReactNode }) {
    return null;
  }
  Route.displayName = 'Route';

  function Routes({ children }: { children?: React.ReactNode }) {
    const ctx = useContext(RouterContext);
    const isDesign = ctx?._env?.mode === 'design';

    const routes = React.Children.toArray(children).filter(
      (child): child is React.ReactElement<{ index?: boolean; path?: string; element: React.ReactNode }> =>
        React.isValidElement(child) && (child.type as any)?.displayName === 'Route'
    ) as Array<React.ReactElement<{ index?: boolean; path?: string; element: React.ReactNode }>>;

    if (routes.length === 0) return null;

    if (isDesign) {
      // 兜底路由（path="*"）若与其他路由使用相同的 element 类型，则不重复展示
      const seenElementTypes = new Set<any>();
      const visibleRoutes = routes.filter((r) => {
        const isCatchAll =
          !r.props.index &&
          (r.props.path === '*' || r.props.path === '/*' || r.props.path === undefined);
        const el = r.props.element;
        const elementType = (React.isValidElement(el) ? el.type : el) ?? el;
        if (!isCatchAll) {
          seenElementTypes.add(elementType);
          return true;
        }
        return !seenElementTypes.has(elementType);
      });

      return (
        <>
          {visibleRoutes.map((r, i) => (
            <React.Fragment key={i}>{r.props.element}</React.Fragment>
          ))}
        </>
      );
    }

    // 页面调试模式：首次渲染时探测目标页对应的路由路径，供 createAppRef 的 layoutEffect 消费
    if (debugPageIndex !== undefined && debugInitialPathRef.current === null) {
      const targetRoute = routes.find((r) => {
        const el = r.props.element;
        const type = React.isValidElement(el) ? el.type : null;
        return type === pageRefRegistry[debugPageIndex].__enhanced__;
      });
      debugInitialPathRef.current = targetRoute
        ? normalizePath(targetRoute.props.index ? '/' : (targetRoute.props.path ?? '/'))
        : ''; // '' 表示目标页不在任何 Route 中
    }

    // runtime：只渲染当前激活的 Route，避免非活跃页面的副作用（如数据请求、定时器）执行
    const currentPath = ctx?.currentPath ?? '';

    // 调试初始化期间（哨兵占位），Routes 暂不渲染任何内容，等待 layoutEffect 设置真实路径
    if (currentPath === '__debug_pending__') return null;
    const active = Math.max(0, findBestRouteIndex(routes, currentPath));
    const activeRoute = routes[active];
    if (!activeRoute) return null;

    const routePath = activeRoute.props.index ? '' : (activeRoute.props.path ?? '');
    const params = parseParams(routePath, currentPath);
    const baseCtx = ctx ?? { currentPath: '', _env: { mode: 'runtime' as const } };
    const branchCtx: RouterContextValue = {
      ...baseCtx,
      params,
      navigate: ctx?.navigate ?? (() => {}),
    };

    return (
      // <div className={css.routesRuntime}>
        <RouterContext.Provider value={branchCtx}>
          {activeRoute.props.element}
        </RouterContext.Provider>
      // </div>
    );
  }

  function createAppRef(store: any, logger: any, useSyncExternalStore: any) {
    return function appRef(Component: any) {
      return (props: any) => {
        /**
         * 页面调试模式下的初始路径：
         * - 用 "__debug_pending__" 哨兵值占位，Routes 子组件 render 时同步把目标路径
         *   写入 debugInitialPathRef，然后 layoutEffect 读取并 setCurrentPath。
         * - 哨兵值保证第一次渲染时不命中任何 Route，避免触发错误页面的副作用。
         * - 约定：Route 的 element 必须是 mybricks.pageRef() 的返回值，探测才能生效。
         * - 非调试模式维持 '' 原有行为。
         */
        const PENDING = '__debug_pending__';
        const [currentPath, setCurrentPath] = useState<string>(
          debugPageIndex !== undefined ? PENDING : ''
        );

        useLayoutEffect(() => {
          setterRef.current = setCurrentPath;

          if (debugPageIndex !== undefined) {
            // Routes 在首次 render 时已同步写入 debugInitialPathRef
            const detectedPath = debugInitialPathRef.current ?? '';
            setCurrentPath(detectedPath || '');
          }

          return () => { setterRef.current = null; };
        }, []);

        const autoStore = useRef<any>(null);
        if (!autoStore.current) {
          autoStore.current = createReactiveStore(store);
        }
        const state = useSyncExternalStore(
          autoStore.current[SYMBOL_SUBSCRIBE],
          autoStore.current[SYMBOL_GETSNAPSHOT]
        );
        // navigateImpl / _env 均为稳定闭包引用，加入依赖无副作用
        const routerContextValue = useMemo<RouterContextValue>(
          () => ({
            currentPath,
            _env,
            navigate: _env.mode === 'runtime' ? navigateImpl : () => {},
          }),
          [currentPath, navigateImpl, _env]
        );

        // 设计态：直接渲染 pageRef 注册表里的所有页面，不走 App 组件 / Routes
        if (_env.mode === 'design') {
          return (
            <RouterContext.Provider value={routerContextValue}>
              {pageRefRegistry.map((Page, i) => (
                <Page key={i} />
              ))}
            </RouterContext.Provider>
          );
        }
        const rootStyle = debugTarget?.rootStyle;

        return (
          <div className={css.routesRuntime} style={{...rootStyle}}>
            <RouterContext.Provider value={routerContextValue}>
              <Component
                {...props}
                _env={_env}
                logger={logger}
                store={autoStore.current}
                _state={state}
              />
            </RouterContext.Provider>
          </div>
        );
      };
    };
  }

  function useNavigate() {
    const ctx = useContext(RouterContext);
    const navigate = ctx?.navigate;
    return useMemo(
      () => (to: string | number, options?: { replace?: boolean }) => {
        navigate?.(to, options);
      },
      [navigate]
    );
  }

  function useLocation(): { pathname: string; search: string; hash: string; state: any } {
    const ctx = useContext(RouterContext);
    const path = ctx?.currentPath ?? '';
    // currentPath 写入时已 normalizePath，无需再次处理
    const pathname = path === '' ? '/' : `/${path}`;
    return useMemo(
      () => ({
        pathname,
        search: '',
        hash: '',
        state: null,
      }),
      [pathname]
    );
  }

  function useParams<T extends Record<string, string | undefined> = Record<string, string>>(): T {
    const ctx = useContext(RouterContext);
    return (ctx?.params ?? {}) as T;
  }

  return { Route, Routes, createAppRef, redirect, useNavigate, useLocation, useParams };
}

// --- mybricks 主入口 ---

export interface CreateMybricksOptions {
  env: { runtime?: boolean; _debugTarget?: { type: 'page'; pageIndex: number; style: React.CSSProperties } };
  logger: any;
  store: any;
  useSyncExternalStore: typeof React.useSyncExternalStore;
}

/**
 * 创建 mybricks 库实例，供 AIJsxRuntime 注入到用户 runtime.jsx 的 require('mybricks')。
 * 作用域限定在单个 AIJsxRuntime 内（含 RouterContext）。
 */
export function createMybricks(options: CreateMybricksOptions) {
  const { env, logger, store, useSyncExternalStore } = options;
  const _env = {
    mode: (env.runtime ? 'runtime' : 'design') as 'design' | 'runtime',
  };

  /**
   * 页面调试模式：指定要单独渲染的页面索引（仅在 runtime 态生效）。
   * undefined 表示不限制（正常渲染所有页面或走 appRef 路由）。
   */
  const debugTarget: any =
    env.runtime && env._debugTarget !== undefined ? env._debugTarget : undefined;

  /**
   * pageRef 注册表：按声明顺序收集所有 pageRef 包装后的组件。
   * 在模块 eval 阶段（pageRef 调用时）填充，在 appRef 设计态渲染时消费。
   * 每次 createMybricks 调用时重新创建，天然隔离（无跨 eval 污染）。
   */
  const pageRefRegistry: any[] = [];
  const pageRefOriginalsSet = new Set<any>();

  const routerLib = createRouterLib(_env, pageRefRegistry, debugTarget);

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
          logger={logger}
          store={autoStore.current}
          _state={state}
        />
      );
    };
  };

  const wrapPageWithStore = (Component: any) => {
    // push 之前捕获，确保 pageIndex 与注册顺序一致
    const pageIndex = pageRefRegistry.length;

    const wrapped = (props: any) => {
      const autoStore = useRef<any>(null);
      if (!autoStore.current) {
        autoStore.current = createReactiveStore(store);
      }
      const state = useSyncExternalStore(
        autoStore.current[SYMBOL_SUBSCRIBE],
        autoStore.current[SYMBOL_GETSNAPSHOT]
      );

      return (
        <div data-zone-type="page" data-desn-page={pageIndex} style={{ minWidth: 1200, minHeight: 600, display: 'inline-block', transform: 'scale(1)', ...env._debugTarget?.style }}>
          <Component
            {...props}
            _env={_env}
            logger={logger}
            store={autoStore.current}
            _state={state}
          />
        </div>
      );
    };
    // 按原始 Component 去重后入注册表（防止同一组件多次 pageRef 调用）
    if (!pageRefOriginalsSet.has(Component)) {
      pageRefOriginalsSet.add(Component);
      pageRefRegistry.push(wrapped);
    }
    return wrapped;
  };

  return {
    comRef: wrapWithStore,
    pageRef: wrapPageWithStore,
    appRef: routerLib.createAppRef(store, logger, useSyncExternalStore),
    Routes: routerLib.Routes,
    Route: routerLib.Route,
    /** @deprecated 建议使用 useNavigate */
    redirect: routerLib.redirect,
    useNavigate: routerLib.useNavigate,
    useLocation: routerLib.useLocation,
    useParams: routerLib.useParams,
    createEnvs,
    createAPI,
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
