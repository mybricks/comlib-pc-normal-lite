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
      return (
        <div className={css.routesDesign}>
          {routes.map((r, i) => (
            <div key={i} className={css.routeDesignItem}>
              {r.props.element}
            </div>
          ))}
        </div>
      );
    }

    const rawPath = ctx?.currentPath ?? '';
    const currentPath = rawPath.replace(/^\/+/, '');
    const activeIndex = routes.findIndex((r) => {
      if (r.props.index) return currentPath === '';
      return (r.props.path ?? '').replace(/^\/+/, '') === currentPath;
    });
    const active = activeIndex >= 0 ? activeIndex : 0;

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

  return {
    comRef: wrapWithStore,
    pageRef: wrapWithStore,
    appRef: routerLib.createAppRef(store, logger, useSyncExternalStore),
    Routes: routerLib.Routes,
    Route: routerLib.Route,
    redirect: routerLib.redirect,
  };
}
