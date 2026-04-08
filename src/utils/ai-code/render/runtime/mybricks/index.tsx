import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useReducer,
  useCallback,
  useEffect
} from 'react';
import { parseFrameSize } from "../utils";
import css from './index.less';
import { debugLogs } from '../../../../../mix/context/debugLogs';
import mixContext from '../../../../../mix/context';

// ─── 轻量级响应式系统（替换 MobX）────────────────────────────────────────────
// 设计原理与 MobX 相同：基于"拉取"模式的依赖追踪。
// 组件渲染时自动收集读取了哪些 observable 属性，属性变更时只通知订阅了该属性的组件重渲染。

/** 订阅回调类型 */
type Listener = () => void;

/**
 * 全局追踪上下文。
 * 当 observer 包裹的组件正在渲染时，此变量指向一个 Set，
 * 用于收集本次渲染所读取到的所有属性监听集合（依赖收集）。
 * 渲染结束后恢复为 null，避免污染其他执行路径。
 */
let currentTracker: Set<Set<Listener>> | null = null;

/**
 * 轻量版 makeAutoObservable（对标 MobX 同名 API）。
 *
 * ⚠️ 关键设计：原地修改（in-place mutation），不返回新对象。
 * MobX 的 makeAutoObservable(this) 不捕获返回值，依赖原地修改 this。
 * 因此我们用 Object.defineProperty 将每个数据属性替换为 getter/setter，
 * 使 this 本身就具备响应式能力，无需依赖 Proxy 返回新对象。
 *
 * 工作流程：
 * 1. 遍历对象自身所有数据属性，将每个属性的当前值存入私有变量。
 * 2. 用 defineProperty 重写该属性为 getter/setter：
 *    - getter：若当前处于 observer 追踪上下文，注册依赖；返回当前值。
 *    - setter：值变更时通知所有订阅该属性的监听器。
 * 3. 遍历原型链方法，将其绑定到 this（确保 action 内 this.xxx = val 能触发 setter）。
 *
 * 用法（与 MobX 完全一致）：
 *   class Store {
 *     count = 0;
 *     constructor() { makeAutoObservable(this); }
 *     inc() { this.count++; }
 *   }
 *   export default new Store();
 */
function makeAutoObservable<T extends object>(target: T): T {
  // 每个属性维护独立的监听器集合，key → Set<Listener>
  const listenerMap = new Map<string, Set<Listener>>();

  /** 懒初始化：首次访问某属性时才创建对应的监听器 Set */
  const getListeners = (key: string): Set<Listener> => {
    if (!listenerMap.has(key)) listenerMap.set(key, new Set());
    return listenerMap.get(key)!;
  };

  // 只处理对象自身的数据属性（不含方法、不含继承属性）
  const ownKeys = Object.getOwnPropertyNames(target);
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
    // 跳过已经是 getter/setter 的属性、函数属性
    if (typeof descriptor.value === 'function') continue;
    if (!('value' in descriptor)) continue;

    // 将原始值存入闭包私有变量
    let internalValue = descriptor.value;

    // 用 getter/setter 原地替换该属性，使 this 本身具备响应式
    Object.defineProperty(target, key, {
      enumerable: descriptor.enumerable ?? true,
      configurable: true,
      get() {
        // 依赖收集：若当前有 observer 追踪上下文，注册此属性的监听 Set
        if (currentTracker) {
          currentTracker.add(getListeners(key));
        }
        return internalValue;
      },
      set(newValue) {
        if (internalValue === newValue) return; // 值未变化，跳过
        internalValue = newValue;
        // 派发更新：快照后通知所有订阅者，防止迭代中集合被修改
        const listeners = listenerMap.get(key);
        if (listeners) {
          [...listeners].forEach(fn => fn());
        }
      }
    });
  }

  // 将原型链方法绑定到 target，确保 action 方法内 this.xxx 能触发上面定义的 setter
  const proto = Object.getPrototypeOf(target);
  if (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)!;
      if (typeof descriptor.value === 'function') {
        // 绑定到 target 自身，覆盖原型方法，确保 this 指向响应式对象
        (target as any)[key] = descriptor.value.bind(target);
      }
    }
  }

  return target;
}

/**
 * 轻量版 observer HOC（对标 mobx-react-lite 的 observer）。
 *
 * 作用：将一个函数组件包裹为"响应式组件"。
 * 每次渲染时自动追踪组件读取了哪些 observable 属性，
 * 当这些属性发生变化时自动触发组件重渲染。
 *
 * 实现原理：
 * 1. 渲染前将 currentTracker 指向本次收集 Set。
 * 2. 执行组件函数，期间所有 observable 的 get 操作会把各自的监听 Set 注册进来。
 * 3. 渲染后（useEffect）将 forceUpdate 订阅到所有收集到的监听 Set。
 * 4. 卸载或下次渲染前清理旧订阅，防止内存泄漏和重复触发。
 */
function observer<P extends object>(Component: React.FC<P>): React.FC<P> {
  const ObserverWrapper: React.FC<P> = (props) => {
    // 用 useReducer 实现 forceUpdate（比 useState 更轻量）
    const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
    // 保存当前订阅的清理函数，每次重渲染前先取消旧订阅
    const cleanupRef = useRef<(() => void) | null>(null);

    // 本次渲染所依赖的 observable 属性监听 Set 集合
    const trackedSets = new Set<Set<Listener>>();

    /**
     * 将 forceUpdate 订阅到本次渲染收集到的所有监听 Set。
     * 先清理旧订阅，再添加新订阅，实现精确的依赖更新。
     */
    const subscribe = () => {
      if (cleanupRef.current) cleanupRef.current();

      const handler: Listener = () => forceUpdate();
      trackedSets.forEach(set => set.add(handler));

      // 记录清理函数，下次订阅或卸载时调用
      cleanupRef.current = () => {
        trackedSets.forEach(set => set.delete(handler));
      };
    };

    // ── 渲染阶段：开启依赖追踪 ──
    const prevTracker = currentTracker;  // 保存外层追踪上下文（支持嵌套 observer）
    currentTracker = trackedSets;
    let rendered: React.ReactElement | null = null;
    try {
      rendered = (Component as any)(props);
    } finally {
      // 无论渲染成功与否，都必须恢复外层追踪上下文
      currentTracker = prevTracker;
    }

    // ── 提交阶段：订阅依赖 ──
    // useEffect 无依赖数组 = 每次渲染后都重新订阅，确保依赖始终最新
    useEffect(() => {
      subscribe();
      // 组件卸载时清理所有订阅，防止内存泄漏
      return () => {
        if (cleanupRef.current) cleanupRef.current();
      };
    });

    return rendered;
  };

  ObserverWrapper.displayName = `Observer(${Component.displayName ?? Component.name ?? 'Component'})`;
  return ObserverWrapper;
}

// ─────────────────────────────────────────────────────────────────────────────

interface CreateMyBricksProps {
  /** 组件ID */
  comId: string
  /** 运行模式标识（对应外层 runtimeMode） */
  runtimeMode?: string
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
  const { comId, runtimeMode, env, data, logger } = props;
  const mdCompiled = data.files.find((file: any) => file.fileName === 'README.md')?.compiled;
  const _env = {
    mode: (env.runtime ? 'runtime' : 'design') as 'design' | 'runtime',
  };
  const debugTarget: any =
    env.runtime && env._debugTarget !== undefined ? env._debugTarget : undefined;
  const filesMap = data.files.reduce((pre, file) => {
    pre[file.fileName] = file
    return pre
  }, {})

  /** 向 debugLogs 追加一条日志记录（按打印顺序入栈） */
  const collectDebugLogs = (entry: { type: string; method: string; args: any[]; result?: any }) => {
    debugLogs.append(comId, { ...entry, timestamp: Date.now(), mode: runtimeMode });
  };


  const ROUTE_TYPE = Symbol('Route')
  const DESIGNPOPUP_TYPE = Symbol('DesignPopup')

  const isDesign = () => {
    return _env.mode === 'design';
  }

  const transformPath = ({ index, path }) => {
    return index ? '/' : (path.startsWith("/") ? path : `/${path}`)
  }

  /**
   * 将路由 pattern 与实际 pathname 做匹配，支持动态参数路由（:param）
   * 返回 null 表示不匹配，否则返回 { params } 对象
   */
  const matchPath = (pattern: string, pathname: string): { params: Record<string, string> } | null => {
    const keys: string[] = []
    const regexStr = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // 转义正则特殊字符（除 * 和 :param）
      .replace(/:([^/]+)/g, (_, key) => {
        keys.push(key)
        return '([^/]+)'
      })
      .replace(/\*/g, '.*')
    const regex = new RegExp(`^${regexStr}$`)
    const match = pathname.match(regex)
    if (!match) return null
    const params = Object.fromEntries(keys.map((k, i) => [k, match[i + 1]]))
    return { params }
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

  /**
   * antd.Drawer 关闭后会设置transformX(100%)
   */
  const pageStyle = isDesign() ? {} : {
    overflow: 'hidden'
  }

  const Page = (params: React.PropsWithChildren<{ path?: string }>) => {
    const { path = '/', children } = params;
    const theme = mixContext.resolveActiveTheme(data);
    const containerRef = useRef<HTMLDivElement>(null);
    const [container, setContainer] = useState<PageContextValue>({ container: document.body });
    const [style, setStyle] = useState<React.CSSProperties>({});

    useLayoutEffect(() => {
      setContainer({ container: containerRef.current! })

      try {
        if (containerRef.current) {
          if (mdCompiled) {
            const firstWidget = containerRef.current?.querySelector('[data-widget-name]');
            const widgetName = firstWidget?.getAttribute('data-widget-name');
            const docs = widgetName && mdCompiled[widgetName];
            const title = docs?.title;
            if (title) {
              containerRef.current!.setAttribute("data-zone-title", title);
            }
          }

          const dataLoc = containerRef.current?.querySelector('[data-loc]')?.getAttribute('data-loc')
          const style: React.CSSProperties = {
            minWidth: 1200,
            width: 'fit-content',
            height: 'fit-content'
          }
          if (dataLoc) {
            const loc = JSON.parse(dataLoc);
            const { files } = loc;
            if (files?.less) {
              const file = filesMap[files.less]
              const lessCode = typeof file?.source === 'string' ? decodeURIComponent(file.source) : ""
              const { width, height } = parseFrameSize(lessCode);
              if (width) {
                style.width = width
                Reflect.deleteProperty(style, "minWidth")
              }
              if (height) {
                style.height = height
              }
            } else {
              console.error('[@动态解析] 请重新编译jsx，支持files', containerRef.current);
            }
          }
          setStyle(style)
        }
      } catch (e) {
        console.error(`[@动态解析]`, e)
      }
    }, [])

    return (
      <div
        ref={containerRef}
        data-zone-type='page'
        data-zone-kind='page'
        data-desn-page={path}
        style={{
          ...style,
          // ...(data?.frameStyle?.width
          //   ? { width: data.frameStyle.width }
          //   : { minWidth: 1200, width: 'fit-content' }
          // ),
          // minHeight: 600,
          transform: 'scale(1)',
          // height: 'fit-content',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          ...pageStyle,
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
          const { path, index, element } = child.props;
          if (element && element.type && element.type.__type !== DESIGNPOPUP_TYPE) {
            /**
             * 1. 如果element渲染弹窗，忽略
             */
            appCtx.registerRoute(transformPath({ index, path }));
          }
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

      const matched = matchPath(propPath, currentPath)
      if (matched) {
        if (Object.keys(matched.params).length > 0) {
          return (
            <RouterContext.Provider value={{ ...routerContext, params: matched.params }}>
              {element}
            </RouterContext.Provider>
          )
        }
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

  const DesignPopup = () => null;
  DesignPopup.__type = DESIGNPOPUP_TYPE

  const popupRef = (Component: any) => {
    const ObservedComponent = observer(Component);
    const DialogRoot = (props) => {
      const theme = mixContext.resolveActiveTheme(data);

      if (isDesign()) {
        const containerRef = useRef<HTMLDivElement>(null);
        const [container, setContainer] = useState<HTMLDivElement | null>(null);
        const [style, setStyle] = useState<React.CSSProperties>({});

        useLayoutEffect(() => {
          setContainer(containerRef.current!)
        }, [])

        useEffect(() => {
          try {
            if (containerRef.current && container) {
              if (mdCompiled) {
                const firstWidget = containerRef.current?.querySelector('[data-widget-name]');
                const widgetName = firstWidget?.getAttribute('data-widget-name');
                const docs = widgetName && mdCompiled[widgetName];
                const title = docs?.title;
                if (title) {
                  containerRef.current!.setAttribute("data-zone-title", title);
                }
              }

              const style: React.CSSProperties = {
                minWidth: 1200,
                width: 'fit-content',
                height: 'fit-content',
                minHeight: 2000,
              }
              const dataLoc = containerRef.current?.querySelector('[data-loc]')?.getAttribute('data-loc')
              if (dataLoc) {
                const loc = JSON.parse(dataLoc);
                const { files } = loc;
                if (files?.less) {
                  const file = filesMap[files.less]
                  const lessCode = typeof file?.source === 'string' ? decodeURIComponent(file.source) : ""
                  const { width, height } = parseFrameSize(lessCode);
                  if (width) {
                    style.width = width
                    Reflect.deleteProperty(style, "minWidth")
                  }
                  if (height) {
                    style.height = height
                    Reflect.deleteProperty(style, "minHeight")
                  }
                  console.log("[style]", style)
                } else {
                  console.error('[@动态解析] 请重新编译jsx，支持files', containerRef.current);
                }
              }
              setStyle(style)
            }
          } catch (e) {
            console.error(`[@动态解析]`, e)
          }
        }, [container])

        return (
          <div
            ref={containerRef}
            data-zone-type="page"
            data-zone-kind="popup"
            data-desn-page={"/"}
            style={{
              ...style,
              display: 'inline-block',
              transform: 'scale(1)',
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

      return DesignPopup
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

  const cssVarToToken = (cssVar) => {
    return cssVar
      .replace(/^--/, '')
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  const useDesignToken = () => {
    const theme = mixContext.resolveActiveTheme(data);
    return theme?.vars?.reduce((pre, cur) => {
      const key = cssVarToToken(cur.propertyName);
      pre[key] = cur.value;
      return pre;
    }, {}) || {}
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
    useDesignToken,
  }
}

export { createMyBricks }
