import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useReducer,
  useCallback
} from 'react';
import { makeAutoObservable } from 'mobx';
import { observer } from 'mobx-react-lite';
import css from './index.less';
import { debugLogs } from '../../../../../mix/context/debugLogs';

interface CreateMyBricksProps {
  /** 组件ID */
  comId: string
  /** 环境 */
  env: {
    runtime: boolean
    _debugTarget?: {
      pageIndex: string;
      style: Record<string, any>
    }
  }
  /** 日志 */
  logger: any

  /** 数据源 */
  data: any;
}

const createMyBricks = (props: CreateMyBricksProps) => {
  const { comId, env, data, logger } = props;
  const _env = {
    mode: (env.runtime ? 'runtime' : 'design') as 'design' | 'runtime',
  };
  const debugTarget: any =
    env.runtime && env._debugTarget !== undefined ? env._debugTarget : undefined;

  /** 向 debugLogs 追加一条日志记录（按打印顺序入栈） */
  const collectDebugLogs = (entry: { type: string; method: string; args: any[]; result?: any }) => {
    debugLogs.append(comId, { ...entry, timestamp: Date.now() });
  };


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

  interface PageContextValue {
    container: HTMLElement
  }
  const PageContext = createContext<PageContextValue>({
    container: document.body
  });

  const Page = (params: React.PropsWithChildren<{ path?: string }>) => {
    const { path = '/', children } = params;
    const { activeThemeId, themes } = data.themes;
    const theme = themes.find((theme) => theme.id === activeThemeId);
    const containerRef = useRef<HTMLDivElement>(null);
    const [container, setContainer] = useState<PageContextValue>({ container: document.body });

    useLayoutEffect(() => {
      setContainer({ container: containerRef.current! })
    }, [])

    return (
      <div
        ref={containerRef}
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
        }}
      >
        <PageContext.Provider value={container}>
          {children}
        </PageContext.Provider>
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

  const popupRefRegistry: React.FC[] = [];
  const popupRefOriginalsSet = new Set<React.FC>();

  const appRef = (Component) => {
    const ObservedComponent = observer(Component);
    return (props) => {
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
              <ObservedComponent {...props} _env={_env}/>
            )}
            {app.state === 'runtime' && (
              collectingRoutes.current.length > 0 ? collectingRoutes.current.map((route) => {
                return (
                  <Page path={route}>
                    <CollectingRoute
                      {...props}
                      _env={_env}
                      _route={route}
                      _Component={ObservedComponent}
                    />
                  </Page>
                )
              }) : (
                <Page path={'/'}>
                  <Route
                    path='/'
                    element={(
                      <ObservedComponent {...props} _env={_env}/>
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
          _route={env._debugTarget?.pageIndex}
          _Component={ObservedComponent}
        />
      )
    }
  }

  const comRef = (Component: any) => {
    const ObservedComponent = observer(Component);
    return (props: any) => {
      const pageContext = useContext(PageContext);
      return (
        <ObservedComponent {...props} _env={_env} popupNode={pageContext.container}/>
      );
    };
  };

  const popupRef = (Component: any) => {
    const ObservedComponent = observer(Component);
    const DialogRoot = (props) => {
      const { activeThemeId, themes } = data.themes;
      const theme = themes.find((theme) => theme.id === activeThemeId);

      if (isDesign()) {
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
            data-desn-page={"/"}
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
            {container && <ObservedComponent
              {...props}
              _env={_env}
              popupNode={container}
              wrapper={container}
            />}
          </div>
        );
      } else {
        const pageContext = useContext(PageContext);
        
        return pageContext.container && (
          <ObservedComponent
            {...props}
            _env={_env}
            popupNode={pageContext.container}
            wrapper={pageContext.container}
          />
        )
      }
    };

    if (isDesign()) {
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

  // 将 logger 的调用同步收集到 debugLogs（设计态、运行态均收集）
  const capturedLogger = new Proxy(logger ?? {}, {
    get(target, prop: string) {
      const original = typeof target[prop] === 'function' ? target[prop] : (() => {});
      return (...args: any[]) => {
        const result = original(...args);
        collectDebugLogs({ type: 'logger', method: prop, args, result });
        return result;
      };
    }
  });
  /**
   * 浮层类组件在设计态默认展开
   */
  const PopupVisible = () => {
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
    appRef,
    comRef,
    popupRef,
    pageRef: comRef, // [TEMP] 兼容老页面
    Routes,
    Route,
    useLocation,
    useNavigate,
    useParams,
    logger: capturedLogger,
    makeAutoObservable,
    /** 供 index.tsx 使用：将 DataSource / spyOn 的调用追加到 debugLogs */
    _collectDebugLogs: collectDebugLogs,
    PopupVisible,
  }
}

export { createMyBricks }
