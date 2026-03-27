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
import css from './index.less';

interface CreateMyBricksProps {
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
  const { env, data, logger } = props;
  const _env = {
    mode: (env.runtime ? 'runtime' : 'design') as 'design' | 'runtime',
  };
  const debugTarget: any =
    env.runtime && env._debugTarget !== undefined ? env._debugTarget : undefined;

  // 将当前模式写入 data._designerState，供 Agent 实时读取
  if (data) {
    if (!data._designerState) data._designerState = { pages: [], popups: [] };
    data._designerState.mode = debugTarget ? 'debug' : _env.mode; // 'design' | 'runtime' | 'debug'
  }


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

  const popupRefRegistry: React.FC[] = [];
  const popupRefOriginalsSet = new Set<React.FC>();

  const appRef = (Component) => {
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
              <Component {...props} _env={_env}/>
            )}
            {app.state === 'runtime' && (
              collectingRoutes.current.length > 0 ? collectingRoutes.current.map((route) => {
                return (
                  <Page path={route}>
                    <CollectingRoute
                      {...props}
                      _env={_env}
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
                      <Component {...props} _env={_env}/>
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
          _Component={Component}
        />
      )
    }
  }

  const comRef = (Component: any) => {
    return (props: any) => {
      return (
        <Component {...props} _env={_env}/>
      );
    };
  };

  const popupRef = (Component: any) => {
    const DialogRoot = (props) => {
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
            {container && <Component
              {...props}
              _env={_env}
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
    logger
  }
}

export { createMyBricks }
