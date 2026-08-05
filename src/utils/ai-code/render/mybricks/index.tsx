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
import { parseFrameSize } from "./utils";
import css from './index.less';
import { debugLogs } from '../../../../mix/context/debugLogs';
import mixContext, { config } from '../../../../mix/context';
import {
  isLoggerMethod,
  mergeLoggerBindings,
  type LoggerBindings,
} from '../logger';
import prototype from './prototype';
import EnvConfigPanel from './env-config-panel';

const useBreakpoints = (path) => {
  const [breakpoint, setBreakpoint] = useState<any>(null)

  useLayoutEffect(() => {
    if (!path) {
      return
    }

    const data = mixContext.component?.params.data
    if (!data.prototype) {
      data.prototype = {}
    }

    const getViewports = () => {
      const event = prototype.events.getEvent('appConfig')
      return Array.isArray(event.cache?.viewports) ? event.cache.viewports : []
    }

    const getMaxBreakpoint = (viewports) => {
      return viewports.reduce((max, item) => {
        const maxWidth = Number(max?.width ?? -Infinity)
        const itemWidth = Number(item?.width ?? -Infinity)
        return itemWidth > maxWidth ? item : max
      }, null)
    }

    const updateBreakpoint = (breakpointId) => {
      const viewports = getViewports()
      const nextBreakpoint = viewports.find((item) => item?.id === breakpointId) || getMaxBreakpoint(viewports)

      if (nextBreakpoint?.id) {
        data.prototype[path] = nextBreakpoint.id
        setBreakpoint(nextBreakpoint)
      } else {
        setBreakpoint(null)
      }
    }

    const fn = (breakpointId) => {
      updateBreakpoint(breakpointId)
    }

    updateBreakpoint(data.prototype[path])
    prototype.events.on(path, fn)

    const off = prototype.events.on('appConfig', (appConfig) => {
      updateBreakpoint(data.prototype[path])
    })

    return () => {
      prototype.events.off(path, fn)
      off()
    }
  }, [path])

  useEffect(() => {
    if (breakpoint) {
      mixContext.component?.actions.loaded?.()
    }
  }, [breakpoint])

  return breakpoint
}

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
    // useLayoutEffect（同步）= 每次渲染后立即订阅，消除 store 热更新时 handler 注册的窗口期
    // 若用 useEffect（异步），store 热更新导致 observer remount 时，
    // 在渲染完成到 useEffect 执行之间若 store 发生变更，handler 尚未注册，响应式丢失
    useLayoutEffect(() => {
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

// 穿透 wrapCustomComponentPlugin 注入的 display:contents wrapper
function unwrapIfCustomWrapper(el: React.ReactElement): React.ReactElement {
  if (
    el.type === 'div' &&
    (el.props as any)['data-custom-com-wrapper'] !== undefined
  ) {
    const child = React.Children.only((el.props as any).children) as React.ReactElement;
    return child;
  }
  return el;
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
  const frontendMode = config.getFrontendMode()

  const Wrapper = config.getFrontendWrapper()

  // 配置的画布信息
  const { width: canvasWidth = 1440, height: canvasHeight = 900, update } = window._sandbox_.config.componentRuntime?.canvas || {}
  
  const { comId, runtimeMode, env, data, logger } = props;

  if (frontendMode === 'prototype') {
    prototype.events.offAll()

    update((appConfig) => {
      prototype.events.emit('appConfig', appConfig)
      if (appConfig.viewports.length > 1) {
        mixContext.component?.actions.updatePages?.([], {
          breakpoints: appConfig.viewports
        })
      }
    })
  }

  // let mdCompiled = data.files.find((file: any) => file.fileName === 'README.md')?.compiled;
  // if (mdCompiled) {
  //   mdCompiled = Object.entries(mdCompiled).reduce((pre, [key, value]) => {
  //     pre[key] = value
  //     pre[key.toLowerCase()] = value
  //     return pre;
  //   }, {})
  // }
  const _env = {
    mode: (env.runtime ? 'runtime' : 'design') as 'design' | 'runtime',
  };
  const debugTarget: any =
    env.runtime && env._debugTarget !== undefined ? env._debugTarget : undefined;

  /** 向 debugLogs 追加一条日志记录（按打印顺序入栈） */
  const collectDebugLogs = (entry: { type: string; method: string; args: any[]; result?: any; bindings?: Record<string, any> }) => {
    debugLogs.append(comId, { ...entry, timestamp: Date.now(), mode: runtimeMode });
  };


  const ROUTE_TYPE = Symbol('Route')
  const DESIGNPOPUP_TYPE = Symbol('DesignPopup')

  const isDesign = () => {
    return _env.mode === 'design';
  }

  const transformPath = ({ index, path }) => {
    return index ? '/' : (path?.startsWith("/") ? path : `/${path || ''}`)
  }

  const isWildcardPath = (path?: string) => {
    return path?.split('/').includes('*') ?? false
  }

  const joinRoutePaths = (base: string, path: string) => {
    if (!path) return base
    if (!base) return path
    if (path === '/') return base
    return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  }

  const getWildcardRouteBase = (path?: string) => {
    if (!isWildcardPath(path)) return null

    const segments = transformPath({ index: null, path }).split('/').filter(Boolean)
    const wildcardIndex = segments.indexOf('*')
    const baseSegments = wildcardIndex >= 0 ? segments.slice(0, wildcardIndex) : segments

    return baseSegments.length > 0 ? `/${baseSegments.join('/')}` : ''
  }

  const stripRouteBase = (path: string, routeBase: string) => {
    if (!routeBase || routeBase === '/') return path
    if (path === routeBase) return '/'
    if (path.startsWith(`${routeBase}/`)) return path.slice(routeBase.length) || '/'
    return path
  }

  const getMatchedWildcardBase = (currentPath: string, splat?: string) => {
    if (splat === undefined) return null
    if (!splat) return currentPath === '/' ? '' : currentPath.replace(/\/$/, '')

    const suffix = `/${splat}`
    return currentPath.endsWith(suffix) ? currentPath.slice(0, -suffix.length) : currentPath
  }

  const escapeRegExp = (value: string) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * 将路由 pattern 与实际 pathname 做匹配，支持动态参数（:param）和通配符（*）
   * 返回 null 表示不匹配，否则返回 { params } 对象
   */
  const matchPath = (pattern: string, pathname: string): { params: Record<string, string> } | null => {
    const keys: string[] = []
    const segments = pattern.split('/').filter(Boolean)

    const regexStr = segments.reduce((regex, segment, index) => {
      if (segment === '*') {
        keys.push('*')
        return index === 0 ? `${regex}/?(.*)` : `${regex}(?:/(.*))?`
      }

      const segmentRegex = segment
        .replace(/:([^/]+)/g, (_, key) => {
          keys.push(key)
          return `__MYBRICKS_ROUTE_PARAM_${keys.length - 1}__`
        })
        .split(/(__MYBRICKS_ROUTE_PARAM_\d+__)/g)
        .map((part) => {
          const matched = part.match(/^__MYBRICKS_ROUTE_PARAM_(\d+)__$/)
          return matched ? '([^/]+)' : escapeRegExp(part)
        })
        .join('')

      return `${regex}/${segmentRegex}`
    }, '')

    const regex = new RegExp(`^${regexStr || '/'}$`)
    const match = pathname.match(regex)
    if (!match) return null
    const designMode = isDesign()
    const params = Object.fromEntries(keys.map((k, i) => {
      const value = match[i + 1] ?? ''
      return [k, designMode ? (`:${k}` === value || (k === '*' && value === '*') ? undefined : value) : value as any]
    }))
    return { params }
  }

  const getRouteScore = (pattern: string, index?: number | boolean) => {
    const segments = pattern.split('/').filter(Boolean)
    return segments.reduce((score, segment) => {
      if (segment === '*') return score - 2
      if (segment.startsWith(':')) return score + 3
      return score + 10
    }, segments.length + (index ? 2 : 0))
  }

  const getRouteMatch = (
    route: { index?: number | boolean; path?: string },
    currentPathWithSearch: string,
    routeBase = ''
  ) => {
    const { index, path } = route
    if (!index && !path) return null

    const searchIndex = currentPathWithSearch.indexOf('?')
    const pathOnly = searchIndex >= 0 ? currentPathWithSearch.slice(0, searchIndex) : currentPathWithSearch
    const currentPath = transformPath({ index: null, path: stripRouteBase(pathOnly, routeBase) })
    const propPath = transformPath({ index, path })
    const matched = matchPath(propPath, currentPath)
    const score = getRouteScore(propPath, index) + (isDesign() && propPath === currentPath ? 1000 : 0)

    return matched ? { matched, score, currentPath } : null
  }

  interface AppContextValue {
    state: 'collect_routes' | 'runtime'
    registerRoute: (route: string, element: React.ReactElement) => void
    routeBase: string
  }
  const AppContext = createContext<AppContextValue>({
    state: 'runtime',
    registerRoute: () => {},
    routeBase: ''
  });

  type NavigateOptions = {
    replace?: boolean
    state?: unknown
  }
  type NavigateFn = (to: string | number, options?: NavigateOptions) => void
  interface RouterContextValue {
    currentPath: string
    search: string
    params: Record<string, string>
    navigate: NavigateFn
    locationState: unknown
    routeBase: string
  }
  const RouterContext = createContext<RouterContextValue>({
    currentPath: '/',
    search: '',
    navigate: () => {},
    locationState: undefined,
    params: {},
    routeBase: ''
  });

  const CollectingRoute = (params: { _route: string, _Component: React.FC<any> }) => {
    const { _route, _Component: Component } = params;
    return (
      <RouterContext.Provider
        value={{
          currentPath: _route,
          search: '',
          navigate: () => {},
          locationState: undefined,
          params: {},
          routeBase: ''
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
    onPageInfo: (params: { widgetName?: string | null, filename: string }) => void
  }
  const PageContext = createContext<PageContextValue>({
    container: document.body,
    onPageInfo: () => {}
  });

  /**
   * antd.Drawer 关闭后会设置transformX(100%)
   */
  const pageStyle = isDesign() ? {} : {
    // overflow: 'hidden' // 绝对定位元素不渲染
  }

  const ENV_CONFIG_FILENAME = 'config/env.json'

  const getEnvCssVariables = (source?: string) => {
    if (typeof source !== 'string') {
      return {}
    }

    try {
      let envConfig: any
      try {
        envConfig = JSON.parse(source)
      } catch {
        envConfig = JSON.parse(decodeURIComponent(source))
      }

      const activeStyle = envConfig?.style?.styles?.find((style) => style?.id === envConfig?.style?.active)
      return activeStyle?.cssVariables?.reduce((variables, category) => {
        if (!Array.isArray(category?.variables)) {
          return variables
        }

        category.variables.forEach(cssVariable => {
          if (
            typeof cssVariable?.name === 'string' &&
            cssVariable.name.startsWith('--') &&
            (typeof cssVariable.value === 'string' || typeof cssVariable.value === 'number')
          ) {
            variables[cssVariable.name] = cssVariable.value
          }
        })
        return variables
      }, {}) || {}
    } catch {
      return {}
    }
  }

  const useEnvCssVariables = () => {
    const fileSystem = mixContext.fileSystem
    const readVariables = () => getEnvCssVariables(fileSystem?.filesMap?.[ENV_CONFIG_FILENAME]?.file?.source)
    const [variables, setVariables] = useState(readVariables)

    useEffect(() => {
      setVariables(readVariables())
      return fileSystem?.events.on('fileChange', ({ filename }) => {
        if (filename === ENV_CONFIG_FILENAME) {
          setVariables(readVariables())
        }
      })
    }, [fileSystem])

    return variables
  }

  const Page = (params: React.PropsWithChildren<{ path?: string, onMount?: (params: any) => void }>) => {
    const { path = '/', onMount, children } = params;
    const theme = mixContext.resolveActiveTheme();
    const envCssVariables = useEnvCssVariables();
    const containerRef = useRef<HTMLDivElement>(null);
    const [container, setContainer] = useState<PageContextValue | null>(null);
    const [style, setStyle] = useState<React.CSSProperties>({      
      width: canvasWidth,
      minHeight: canvasHeight
    });
    const lessRef = useRef<{ filename: string, off: () => void }>({
      filename: '',
      off: () => {}
    });

    useEffect(() => {
      return () => {
        lessRef.current?.off?.()
      }
    }, [])

    useLayoutEffect(() => {
      setContainer({
        container: containerRef.current!,
        onPageInfo: (params) => {
          try {
            if (containerRef.current) {
              containerRef.current.setAttribute('data-zone-filename', params.filename)
              let widgetName = params?.widgetName
              if (!widgetName) {
                const firstWidget = containerRef.current.querySelector('[data-widget-name]');
                widgetName = firstWidget?.getAttribute('data-widget-name');
              }
              // 将 widgetName 直接写到区域容器上，这样 MutationObserver 无需再深入子树找 data-widget-name
              if (widgetName) {
                containerRef.current.setAttribute("data-widget-name", widgetName);
              }
              // if (mdCompiled) {
              //   const docs = widgetName && (mdCompiled[widgetName] || mdCompiled[widgetName.toLowerCase()]);
              //   const title = docs?.title;
              //   if (title) {
              //     containerRef.current.setAttribute("data-zone-title", title);
              //   }
              // }

              const container = containerRef.current.querySelector(`[data-widget-name="${widgetName}"]`)
              let dataLoc = container?.getAttribute('data-loc') || container?.querySelector('[data-loc]')?.getAttribute('data-loc')

              if (!dataLoc) {
                dataLoc = containerRef.current.querySelector('[data-loc]')?.getAttribute('data-loc')
              }

              if (dataLoc) {
                const loc = JSON.parse(dataLoc);
                const { files } = loc;
                if (files?.less && frontendMode !== 'prototype') {
                  if (files.less !== lessRef.current.filename) {
                    const fileSystem = mixContext.fileSystem
                    lessRef.current.off()
                    lessRef.current.filename = files.less
                    lessRef.current.off = fileSystem.fileWatcher.watch(files.less, (event) => {
                      const { file, type } = event
                      if (['create', 'update'].includes(type)) {
                        const lessCode = typeof file?.source === 'string' ? decodeURIComponent(file.source) : ""
                        const style = {
                          width: canvasWidth,
                          minHeight: canvasHeight
                        }
                        const { width, height } = parseFrameSize(lessCode);
                        if (width) {
                          // const numberWidth = parseInt(width)
                          // style.width = numberWidth > canvasWidth ? canvasWidth : numberWidth
                          style.width = width
                        }
                        if (height) {
                          style.minHeight = height
                        } else {
                          const bcr = containerRef.current!.getBoundingClientRect()
                          if (bcr.height) {
                            Reflect.deleteProperty(style, 'minHeight')
                          }
                        }
                        setStyle(style)
                      }
                    })
                  }
                } else {
                  // console.error('[@动态解析] 请重新编译jsx，支持files', containerRef.current);
                }

                if (files?.jsx && widgetName) {
                  const fileSystem = mixContext.fileSystem
                  const jsDocMap = fileSystem?.filesMap?.[params.filename]?.file?.jsDocMap || fileSystem?.filesMap?.[files.jsx]?.file?.jsDocMap
                  if (jsDocMap) {
                    const jsDoc = JSON.parse(decodeURIComponent(jsDocMap))
                    const title = jsDoc?.[widgetName]?.title
                    if (title) {
                      containerRef.current.setAttribute("data-zone-title", title);
                    }
                  }
                }
              }
            }
          } catch (e) {
            // console.error(`[@动态解析]`, e)
          }
          onMount?.(params)
        }
      })
    }, [])

    const breakpoint = useBreakpoints(path)

    useLayoutEffect(() => {
      if (frontendMode === 'prototype' && isDesign()) {
        const cssFileNames: string[] = []
        const unwatchList: Array<() => void> = []
        const fileSystem = mixContext.fileSystem
        const STYLE_REPLACE_ID = '__mybricks_ai_module_id__';
        const setLessCss = (filename: string) => {
          const entry = fileSystem?.filesMap?.[filename]
          if (!entry || !entry.file.filename.endsWith('.less')) {
            return
          }

          const { file, module } = entry
          const { cssContent, mediaQueries } = module

          const value = breakpoint?.width ?? canvasWidth

          const cssText = mediaQueries.reduce((pre, cur) => {
            const match = cur.conditionText.match(/max-width:\s*(\d+)px/)
            if (!match) {
              return pre
            }
            const width = parseInt(match[1])

            if (value <= width) {
              return pre.replace(cur.placeholder, cur.cssText)
            }

            return pre
          }, cssContent)

          const myContent = cssText.replaceAll(`.${STYLE_REPLACE_ID}`, `:where(.${comId} [data-desn-page='${path}'])`)
            .replace(/:where\(\.[^)]+\)\s*(:root\b)/g, ':host') // 引擎shadowdom内oot替换为:host
          // 组件id + 文件路径，保证唯一性
          const cssId = `${comId}_${path}_${file.filename}`.replace(/[^0-9a-zA-Z]/g, '_')
          if (!cssFileNames.includes(cssId)) {
            cssFileNames.push(cssId)
          }
          ;(env as any).canvas.css.set(cssId, myContent)
        }

        Object.entries(fileSystem?.filesMap ?? {}).forEach(([filename, { file }]) => {
          if (file.filename.endsWith('.less')) {
            unwatchList.push(fileSystem!.fileWatcher.watch(filename, (event) => {
              if (['create', 'update'].includes(event.type)) {
                setLessCss(filename)
              }
            }))
          }
        })

        return () => {
          unwatchList.forEach(unwatch => unwatch())
          if (frontendMode === 'prototype') {
            cssFileNames.forEach(id => (env as any).canvas.css.remove(id))
          }
        }
      }
    }, [breakpoint])

    return (
      <div
        ref={containerRef}
        data-zone-type='page'
        data-zone-kind='page'
        data-desn-page={path}
        data-zone-title='页面'
        {...(breakpoint ? {
          ['data-zone-show-type']: breakpoint.id,
        } : {})}
        style={{
          // [TODO]
          // height: '100%',
          width: 'fit-content',
          height: 'fit-content',
          ...style,
          ...(breakpoint && isDesign() ? {
            width: breakpoint.width,
            minWidth: breakpoint.width,
            maxWidth: breakpoint.width,
          } : {}),
          // ...(data?.frameStyle?.width
          //   ? { width: data.frameStyle.width }
          //   : { minWidth: 1200, width: 'fit-content' }
          // ),
          // minHeight: 600,
          transform: 'scale(1)',
          // height: 'fit-content',
          ...pageStyle,
          ...env._debugTarget?.style,
          ...theme?.vars?.reduce((pre, cur) => {
            pre[cur.propertyName] = cur.value;
            return pre;
          }, {}),
          ...envCssVariables,
        }}
      >
        {container && <PageContext.Provider value={container}>
          {children}
        </PageContext.Provider>}
      </div>
    )
  }

  const RuntimeRoute = (params: { _route: string, _Component: React.FC<any> }) => {
    const { _route, _Component: Component } = params;
    const [{ stack, cursor }, dispatch] = useReducer(
      routerReducer,
      { stack: [{ path: _route, state: undefined }], cursor: 0 }
    )

    const currentEntry = stack[cursor]
    const rawPath = currentEntry.path || '/'
    const searchIndex = rawPath.indexOf('?')
    const currentPath = searchIndex >= 0 ? rawPath.slice(0, searchIndex) : rawPath
    const currentSearch = searchIndex >= 0 ? rawPath.slice(searchIndex) : ''

    // navigate 无外部依赖，引用永远稳定，不会触发消费者重渲染
    const navigate = useCallback((to, options: any = {}) => {
      if (typeof to === 'number') dispatch({ type: 'GO', delta: to })
      else if (options.replace) dispatch({ type: 'REPLACE', to, state: options.state })
      else dispatch({ type: 'PUSH', to, state: options.state })
    }, [])

    const locationState = currentEntry.state

    const contextValue = useMemo<RouterContextValue>(
      () => ({ currentPath, search: currentSearch, params: {}, navigate, locationState, routeBase: '' }),
      [currentPath, currentSearch, navigate, locationState]
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
    const routerContext = useContext(RouterContext)
    if (appCtx.state === 'collect_routes') {
      React.Children.forEach(children, (child) => {
        if (React.isValidElement(child) && (child.type as any).__type === ROUTE_TYPE) {
          const { path, index, element } = child.props;
          if (element && element.type && element.type.__type !== DESIGNPOPUP_TYPE) {
            /**
             * 1. 如果element渲染弹窗，忽略
             * 2. 通配符路由通常作为布局/兜底承载具体子路由，自身不作为独立页面收集
             */
            if (!isWildcardPath(path)) {
              appCtx.registerRoute(
                joinRoutePaths(appCtx.routeBase, transformPath({ index, path })),
                element
              );
            }
          }
        }
      });

      return children;
    }

    let matchedChild: React.ReactNode = null
    let matchedScore = -Infinity

    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child) || (child.type as any).__type !== ROUTE_TYPE) return

      const routeMatch = getRouteMatch(child.props, routerContext.currentPath, routerContext.routeBase)
      if (routeMatch && routeMatch.score > matchedScore) {
        matchedChild = child
        matchedScore = routeMatch.score
      }
    });

    return matchedChild;
  }

  const Route = (params: { index?: number | boolean; path?: string; element: React.ReactElement}) => {
    const { index, path, element } = params;
    const appContext = useContext(AppContext)
    const routerContext = useContext(RouterContext)

    if (!element) {
      return null
    }

    if (appContext.state === 'collect_routes') {
      const nextElement = element.props['data-loc'] ? element : React.cloneElement(element, { ['data-loc']: '1' })
      const wildcardBase = getWildcardRouteBase(path)

      if (wildcardBase !== null) {
        return (
          <AppContext.Provider
            value={{
              ...appContext,
              routeBase: joinRoutePaths(appContext.routeBase, wildcardBase)
            }}
          >
            {nextElement}
          </AppContext.Provider>
        )
      }

      return nextElement
    } else if (index || path) {
      const routeMatch = getRouteMatch({ index, path }, routerContext.currentPath, routerContext.routeBase)
      if (routeMatch) {
        // 兼容，做拖拽dom能力，在外层包了一个div，需要这个函数来做判断
        const actualElement = unwrapIfCustomWrapper(element);
        const nextElement = React.cloneElement(actualElement, {
          ['data-loc']: actualElement.props['data-loc'] || '1',
          ['_mybricks_page']: true
        })

        const wildcardBase = getMatchedWildcardBase(routeMatch.currentPath, routeMatch.matched.params['*'])
        const mergedContext = {
          ...routerContext,
          params: { ...routerContext.params, ...routeMatch.matched.params },
          routeBase: wildcardBase !== null ? joinRoutePaths(routerContext.routeBase, wildcardBase) : routerContext.routeBase
        }

        if (
          Object.keys(routeMatch.matched.params).length > 0 ||
          routerContext.search ||
          wildcardBase !== null
        ) {
          return (
            <RouterContext.Provider value={mergedContext}>
              {nextElement}
            </RouterContext.Provider>
          )
        }
        return nextElement;
      }
    }

    return null
  }

  Route.__type = ROUTE_TYPE

  const useLocation = (): { pathname: string; search: string; state: unknown } => {
    const ctx = useContext(RouterContext)
    if (!ctx) throw new Error('useLocation must be used within a <Routes>')
    return { pathname: ctx.currentPath, search: ctx.search, state: ctx.locationState }
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

  const popupRefRegistry: Record<string, React.FC[]> = {};
  let popupRefRegistryForceUpdate: (() => void) | null = null;

  const EnvConfigPanelContainer = () => {
    const [, forceUpdate] = useReducer((n: number) => n + 1, 0)

    useEffect(() => {
      const fileSystem = mixContext.fileSystem
      return fileSystem?.events.on('fileChange', ({ filename, type }) => {
        if (filename === ENV_CONFIG_FILENAME && ['create', 'update', 'delete'].includes(type)) {
          forceUpdate()
        }
      })
    }, [])

    const envFile = mixContext.fileSystem?.filesMap?.[ENV_CONFIG_FILENAME]?.file
    return envFile ? (
      <div data-zone-kind="config" style={{ width: 480, maxHeight: '100vh', overflowY: 'auto' }}>
        <EnvConfigPanel
          env={envFile.source}
          onSave={(source) => mixContext.updateFile({ fileName: ENV_CONFIG_FILENAME, content: source })}
        />
      </div>
    ) : null
  }

  const appRef = (Component) => {
    const ObservedComponent = observer(Component);
    return (props) => {
      if (isDesign()) {
        const collectingRoutes = useRef<string[]>([]);
        const collectingRouteTypes = useRef<Set<React.ElementType>>(new Set());
        const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
        React.useEffect(() => {
          popupRefRegistryForceUpdate = forceUpdate;
          return () => {
            if (popupRefRegistryForceUpdate === forceUpdate) popupRefRegistryForceUpdate = null;
          };
        }, [forceUpdate]);

        const [app, setApp] = useState<AppContextValue>({
          state: 'collect_routes',
          registerRoute: (path: string, element: React.ReactElement) => {
            if (frontendMode === 'default') {
              // A page can be registered under several routes. Render it once on the design canvas.
              if (collectingRouteTypes.current.has(element.type)) return;
              collectingRouteTypes.current.add(element.type);
            }
            collectingRoutes.current.push(path);
          },
          routeBase: ''
        })

        const mountRef = useRef(0)

        useLayoutEffect(() => {
          // @ts-ignore
          window.__mybricksai_collectingRoutes__ = () => {
            return collectingRoutes;
          }
          setApp((app) => {
            return {
              ...app,
              state: 'runtime'
            }
          })
        }, [])

        const onMount = useCallback((params) => {
          mountRef.current = mountRef.current + 1
          const dialogRootsCount = Object.values(popupRefRegistry).reduce((sum, arr) => sum + arr.length, 0)
          let totalMountCount = (collectingRoutes.current.length || 1) + dialogRootsCount
          if (mountRef.current >= totalMountCount) {
            mixContext.component?.actions.loaded?.()
          }
        }, [])

        return (
          <AppContext.Provider value={app}>
            <EnvConfigPanelContainer />
            {app.state === "collect_routes" && (
              <ObservedComponent {...props} _env={_env}/>
            )}
            {app.state === 'runtime' && (
              <>
                {collectingRoutes.current.length > 0 ? collectingRoutes.current.map((route) => {
                  return (
                    <Page
                      path={route}
                      onMount={onMount}
                    >
                      <CollectingRoute
                        {...props}
                        _env={_env}
                        _route={route}
                        _Component={ObservedComponent}
                      />
                    </Page>
                  )
                }) : (
                  <Page
                    path={'/'}
                    onMount={onMount}
                  >
                    <Route
                      path='/'
                      element={(
                        <ObservedComponent {...props} _env={_env}/>
                      )}
                    />
                  </Page>
                )}
              </>
            )}
            {app.state === 'runtime' && (
              Object.entries(popupRefRegistry).map(([filename, DialogRoots]) => {
                return DialogRoots.map((DialogRoot) => {
                  // @ts-ignore
                  return <DialogRoot key={filename} onMount={onMount} __mybricks_show/>
                })
              })
            )}
          </AppContext.Provider>
        )
      }

      useLayoutEffect(() => {
        let cssFileNames: string[] = []
        if (frontendMode === 'prototype') {
          const showType = env._debugTarget.showType
          const fileSystem = mixContext.fileSystem
          const STYLE_REPLACE_ID = '__mybricks_ai_module_id__';
          const event = prototype.events.getEvent('appConfig')
          const breakpoint = event.cache.viewports.find((item) => item.id === showType)
          const value = breakpoint.width
          Object.entries(fileSystem!.filesMap).forEach(([_, { file, module }]) => {
            if (file.filename.endsWith('.less')) {
              const { cssContent, mediaQueries } = module
              const cssText = mediaQueries.reduce((pre, cur) => {
                const match = cur.conditionText.match(/max-width:\s*(\d+)px/)
                if (!match) {
                  return pre
                }
                const width = parseInt(match[1])

                if (value <= width) {
                  return pre.replace(cur.placeholder, cur.cssText)
                }

                return pre
              }, cssContent)

              const myContent = cssText.replaceAll(`.${STYLE_REPLACE_ID}`, `:where(.${comId})`)
                .replace(/:where\(\.[^)]+\)\s*(:root\b)/g, ':host') // 引擎shadowdom内oot替换为:host
              // 组件id + 文件路径，保证唯一性
              const cssId = `${comId}_${file.filename}`.replace(/\./g, '__').replace(/\//g, '_')
              cssFileNames.push(cssId)
              env.canvas.css.set(cssId, myContent)
            }
          })
        }

        return () => {
          if (frontendMode === 'prototype') {
            cssFileNames.forEach(id => env.canvas.css.remove(id))
          }
        }
      }, [])

      if (props._standalone) {
        /**
         * 独立渲染，不使用默认的react-router-dom
         */
        return <ObservedComponent {...props} _env={_env}/>
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

  const comRef = (Component: any, params) => {
    const ObservedComponent = observer(Component);

    return function comRef (props: any) {
      const pageContext = useContext(PageContext);

      if (props['_mybricks_page']) {
        useLayoutEffect(() => {
          pageContext.onPageInfo(params)
        }, [])
      }

      if (props['_mybricks_page'] && Wrapper) {
        return (
          <Wrapper
            container={pageContext.container}
          >
            <ObservedComponent {...props} _env={_env} popupNode={pageContext.container}/>
          </Wrapper>
        )
      }

      return (
        <ObservedComponent {...props} _env={_env} popupNode={pageContext.container}/>
      );
    };
  };

  const DesignPopup = () => null;
  DesignPopup.__type = DESIGNPOPUP_TYPE

  const popupRef = (Component: any, params) => {
    const ObservedComponent = observer(Component);
    const { ErrorView } = params;
    let realProps = {}
    const DialogRoot = (props) => {
      if (isDesign() && !props.__mybricks_show) {
        realProps = props
        return null
      }
      const theme = mixContext.resolveActiveTheme();
      const envCssVariables = useEnvCssVariables();

      if (isDesign()) {
        const containerRef = useRef<HTMLDivElement>(null);
        const [container, setContainer] = useState<HTMLDivElement | null>(null);
        const [style, setStyle] = useState<React.CSSProperties>({
          width: canvasWidth,
          minWidth: canvasWidth,
          maxWidth: canvasWidth,
          height: canvasHeight
        });
        const lessRef = useRef<{ filename: string, off: () => void }>({
          filename: '',
          off: () => {}
        });

        useLayoutEffect(() => {
          const getPopupWidth = (appConfig) => {
            const viewports = Array.isArray(appConfig?.viewports) ? appConfig.viewports : []
            const maxBreakpoint = viewports.reduce((max, item) => {
              const maxWidth = Number(max?.width ?? -Infinity)
              const itemWidth = Number(item?.width ?? -Infinity)
              return itemWidth > maxWidth ? item : max
            }, null)
            return maxBreakpoint ? Number(maxBreakpoint.width) : canvasWidth
          }
          const off = prototype.events.on('appConfig', (appConfig) => {
            const width = getPopupWidth(appConfig)
            setStyle((prev) => ({
              ...prev,
              minWidth: width,
              maxWidth: width,
              width
            }))
          })
          return () => {
            lessRef.current?.off?.()
            off()
          }
        }, [])

        useLayoutEffect(() => {
          setContainer(containerRef.current!)
        }, [])

        useEffect(() => {
          try {
            if (containerRef.current && container) {
              containerRef.current.setAttribute('data-zone-filename', params.filename)
              let widgetName = params?.widgetName
              if (!widgetName) {
                const firstWidget = containerRef.current?.querySelector('[data-widget-name]');
                widgetName = firstWidget?.getAttribute('data-widget-name');
              }
              // if (mdCompiled) {
              //   const docs = widgetName && (mdCompiled[widgetName] || mdCompiled[widgetName.toLowerCase()]);
              //   const title = docs?.title;
              //   if (title) {
              //     containerRef.current!.setAttribute("data-zone-title", title);
              //   }
              // }

              const container = containerRef.current?.querySelector(`[data-widget-name="${widgetName}"]`)
              let dataLoc = container?.getAttribute('data-loc') || container?.querySelector('[data-loc]')?.getAttribute('data-loc')

              if (!dataLoc) {
                dataLoc = containerRef.current?.querySelector('[data-loc]')?.getAttribute('data-loc')
              }

              if (dataLoc) {
                const loc = JSON.parse(dataLoc);
                const { files } = loc;
                if (files?.less && frontendMode !== 'prototype') {
                  if (files.less !== lessRef.current.filename) {
                    const fileSystem = mixContext.fileSystem
                    lessRef.current.off()
                    lessRef.current.filename = files.less
                    lessRef.current.off = fileSystem.fileWatcher.watch(files.less, (event) => {
                      const { file, type } = event
                      if (['create', 'update'].includes(type)) {
                        const lessCode = typeof file?.source === 'string' ? decodeURIComponent(file.source) : ""
                        const style: React.CSSProperties = {
                          width: canvasWidth,
                          height: canvasHeight
                        }
                        const { width, height } = parseFrameSize(lessCode);
                        if (width) {
                          const numberWidth = parseInt(width)
                          style.width = numberWidth > canvasWidth ? canvasWidth : numberWidth
                        }
                        if (height) {
                          style.height = height
                        }
                        setStyle(style)
                      }
                    })
                  }
                } else {
                  // console.error('[@动态解析] 请重新编译jsx，支持files', containerRef.current);
                }

                if (files?.jsx && widgetName) {
                  const fileSystem = mixContext.fileSystem
                  const jsDocMap = fileSystem?.filesMap?.[params.filename]?.file?.jsDocMap || fileSystem?.filesMap?.[files.jsx]?.file?.jsDocMap
                  if (jsDocMap) {
                    const jsDoc = JSON.parse(decodeURIComponent(jsDocMap))
                    const title = jsDoc?.[widgetName]?.title
                    if (title) {
                      containerRef.current.setAttribute("data-zone-title", title);
                    }
                  }
                }
              }

              props.onMount?.(params)
            }
          } catch (e) {
            // console.error(`[@动态解析]`, e)
          }
        }, [container])

        return (
          <div
            ref={containerRef}
            data-zone-type="page"
            data-zone-kind="popup"
            data-desn-page={"/"}
            data-zone-title='弹窗'
            data-widget-name={params.widgetName}
            className={css.popupContainer}
            style={{
              ...style,
              display: 'inline-block',
              transform: 'scale(1)',
              ...theme?.vars?.reduce((pre, cur) => {
                pre[cur.propertyName] = cur.value;
                return pre;
              }, {}),
              ...envCssVariables
            }}>
            {container && (
              <PageContext.Provider value={{ container, onPageInfo: () => {} }}>
                <ErrorView>
                  <ObservedComponent
                    {...props}
                    {...realProps}
                    _env={_env}
                    popupNode={container}
                    wrapper={container}
                  />
                </ErrorView>
              </PageContext.Provider>
            )}
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
      if (!popupRefRegistry[params.filename]) {
        popupRefRegistry[params.filename] = []
      }
      popupRefRegistry[params.filename].push(DialogRoot)
      popupRefRegistryForceUpdate?.();
    }
    return DialogRoot
  };

  const createCapturedLogger = (targetLogger: any = {}, bindings: LoggerBindings = {}) => {
    return new Proxy(targetLogger ?? {}, {
      get(target, prop: string | symbol) {
        if (prop === 'child') {
          return (nextBindings?: LoggerBindings | string) => {
            const childBindings = mergeLoggerBindings(bindings, nextBindings);
            const originalChild = typeof target.child === 'function' ? target.child.bind(target) : null;
            const childLogger = originalChild ? originalChild(nextBindings) : {};

            return createCapturedLogger(childLogger, childBindings);
          };
        }

        if (!isLoggerMethod(prop)) {
          return () => {};
        }

        const original = typeof target[prop] === 'function' ? target[prop].bind(target) : (() => {});

        return (...args: any[]) => {
          const result = original(...args);
          collectDebugLogs({ type: 'logger', method: prop, args, bindings, result });
          return result;
        };
      }
    });
  };

  const nextLogger = logger({ id: comId, mode: _env.mode })
  // 将 logger 的调用同步收集到 debugLogs（设计态、运行态均收集）
  const capturedLogger = createCapturedLogger(nextLogger);
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
    const theme = mixContext.resolveActiveTheme();
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
    /** 供运行时内部追加 logger 日志 */
    _collectDebugLogs: collectDebugLogs,
    PopupVisible,
    useDesignToken,

    /**
     * [TODO] 
     * 后续把这里和next-runtime合并
     * 引入热更新机制
     */
    _refreshPopups: (filename) => {
      if (popupRefRegistry[filename]?.length) {
        popupRefRegistry[filename] = []
        popupRefRegistryForceUpdate?.()
      }
    },
    updateConfigJson(filename, content) {
      try {
        if (filename === ENV_CONFIG_FILENAME) {
          mixContext.updateFile({ fileName: filename, content: JSON.stringify(content, null, 2) })
        }
      } catch (e) {
        console.error(e)
      }
    }
  }
}

export { createMyBricks }
