import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
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
          return value.bind(
            new Proxy(
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
          );
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
  const collectionsListener = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  const subscribe = (callback: () => void) => {
    listeners.add(callback);
    return () => {
      collectionsListener.forEach((destroy) => destroy());
      listeners.delete(callback);
    };
  };
  const getSnapshot = () => state;

  return new Proxy({} as any, {
    get(_target, key) {
      if (key === SYMBOL_SUBSCRIBE) return subscribe;
      if (key === SYMBOL_GETSNAPSHOT) return getSnapshot;
      const value = store[key];
      if (!collectionsListener.has(key as string)) {
        const collectionListener = ({ key: k, value: v }: { key: string; value: any }) => {
          state[k] = v;
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

// --- 路由相关：RouterContext / Route / Routes / redirect / appRef ---

interface RouterContextValue {
  currentPath: string;
  _env: { mode: 'design' | 'runtime' };
}

/**
 * 创建当前 AIJsxRuntime 实例专属的路由 API。
 * 路由状态用 useState 管理，与业务 store 完全解耦。
 * 每次调用返回新的 RouterContext，作用域限定在一个 AIJsxRuntime 内。
 */
function createRouterLib(_env: { mode: 'design' | 'runtime' }) {
  const RouterContext = createContext<RouterContextValue | null>(null);

  /** 保存当前 appRef 实例的 setCurrentPath，供 redirect 调用 */
  let _setCurrentPath: ((p: string) => void) | null = null;

  /** 跳转路由：runtime 下切换当前展示的 Route；design 下无效 */
  const redirect = (path: string) => {
    _setCurrentPath?.(path);
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
      // 兜底路由（path="*" 或 path="/*"）若与其他路由使用相同的 element 引用，则不重复展示
      const seenElementTypes = new Set<any>();
      const visibleRoutes = routes.filter((r) => {
        const isCatchAll =
          !r.props.index &&
          (r.props.path === '*' || r.props.path === '/*' || r.props.path === undefined);
        const elementType = r.props.element?.type ?? r.props.element;
        if (!isCatchAll) {
          seenElementTypes.add(elementType);
          return true;
        }
        // 兜底路由：element 类型已被其他路由使用过则跳过
        return !seenElementTypes.has(elementType);
      });

      return (
        <>
          {visibleRoutes.map((r, i) => (
            r.props.element
          ))}
        </>
      )

      // return (
      //   <div className={css.routesDesign}>
      //     {visibleRoutes.map((r, i) => (
      //       <div key={i} className={css.routeDesignItem}>
      //         {r.props.element}
      //       </div>
      //     ))}
      //   </div>
      // );
    }

    const active = Math.max(0, findBestRouteIndex(routes, ctx?.currentPath ?? ''));

    return (
      <div className={css.routesRuntime}>
        {routes.map((r, i) => (
          <div
            key={i}
            className={css.routeRuntimeItem}
            style={{ display: i === active ? 'block' : 'none' }}
          >
            {r.props.element}
          </div>
        ))}
      </div>
    );
  }

  function createAppRef(store: any, logger: any, useSyncExternalStore: any) {
    return function appRef(Component: any) {
      return (props: any) => {
        const [currentPath, setCurrentPath] = useState('');
        _setCurrentPath = setCurrentPath;

        const autoStore = useRef<any>(null);
        if (!autoStore.current) {
          autoStore.current = createReactiveStore(store);
        }
        const state = useSyncExternalStore(
          autoStore.current[SYMBOL_SUBSCRIBE],
          autoStore.current[SYMBOL_GETSNAPSHOT]
        );
        const routerContextValue = useMemo<RouterContextValue>(
          () => ({ currentPath, _env }),
          [currentPath]
        );
        return (
          <RouterContext.Provider value={routerContextValue}>
            <Component
              {...props}
              _env={_env}
              logger={logger}
              store={autoStore.current}
              _state={state}
            />
          </RouterContext.Provider>
        );
      };
    };
  }

  return { Route, Routes, createAppRef, redirect };
}

// --- mybricks 主入口 ---

export interface CreateMybricksOptions {
  env: { runtime?: boolean };
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
  const routerLib = createRouterLib(_env);

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
        <div data-zone-type="page" style={{ width: 1200, minHeight: 600, display: 'inline-block' }}>
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
  };

  return {
    comRef: wrapWithStore,
    pageRef: wrapPageWithStore,
    appRef: routerLib.createAppRef(store, logger, useSyncExternalStore),
    Routes: routerLib.Routes,
    Route: routerLib.Route,
    redirect: routerLib.redirect,
  };
}
