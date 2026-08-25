import React, { useState, useLayoutEffect, useRef } from 'react'
import { registerSandbox, refreshLocalGraph } from './sandbox/forLocalIframe' 
import context from './context'
import { Events } from "../utils/events";

export const localIframeEvents = new Events<{
  'openPage': { id: string }
}>();

const LOCAL_IFRAME_PATH = '/__local/lingchuang'

const normalizeRoute = (route: string) => {
  const normalized = route.trim()
  if (!normalized || normalized === '/') {
    return '/'
  }
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withLeadingSlash.replace(/\/+$/, '') || '/'
}

const getIframeRoute = (iframe: HTMLIFrameElement) => {
  try {
    const pathname = iframe.contentWindow?.location.pathname
    if (!pathname || pathname === LOCAL_IFRAME_PATH || pathname === `${LOCAL_IFRAME_PATH}/`) {
      return '/'
    }
    const route = pathname.startsWith(`${LOCAL_IFRAME_PATH}/`)
      ? pathname.slice(LOCAL_IFRAME_PATH.length) || '/'
      : pathname
    return normalizeRoute(route)
  } catch {
    // 跨源 iframe 无法读取 location，使用 load 时记录的路由兜底。
    return null
  }
}

const RuntimeIframe = (props) => {
  const [iframes, setIframes] = useState(() => [{ key: 'default', route: '/', srcRoute: '/' }])
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({})
  const iframeRoutesRef = useRef<Record<string, string>>({ default: '/' })
  const iframeRouteCleanupsRef = useRef<Record<string, (() => void) | undefined>>({})
  const nextIframeIdRef = useRef(0)

  const syncIframeRoute = (key: string, iframe: HTMLIFrameElement, notify = false) => {
    const route = getIframeRoute(iframe)
    if (!route) {
      return
    }

    const previousRoute = iframeRoutesRef.current[key]
    iframeRoutesRef.current[key] = route
    setIframes((current) => {
      let changed = false
      const next = current.map((item) => {
        if (item.key !== key || item.route === route) {
          return item
        }
        changed = true
        return { ...item, route }
      })
      return changed ? next : current
    })

    if (notify || previousRoute !== route) {
      // console.log('onIframeLoad', route, iframe.contentDocument)
      props.onIframeLoad({
        id: route,
        doc: iframe.contentDocument
      })
    }
  }

  const watchIframeRoute = (key: string, iframe: HTMLIFrameElement) => {
    iframeRouteCleanupsRef.current[key]?.()

    const iframeWindow = iframe.contentWindow
    if (!iframeWindow) {
      return
    }

    const history = iframeWindow.history
    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState
    const notifyRouteChange = () => {
      // 路由库通常会在 history 调用后再更新 DOM，放到微任务中读取最终地址。
      Promise.resolve().then(() => syncIframeRoute(key, iframe))
    }
    const pushState = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = originalPushState.apply(this, args)
      notifyRouteChange()
      return result
    }
    const replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
      const result = originalReplaceState.apply(this, args)
      notifyRouteChange()
      return result
    }

    history.pushState = pushState
    history.replaceState = replaceState
    iframeWindow.addEventListener('popstate', notifyRouteChange)
    iframeWindow.addEventListener('hashchange', notifyRouteChange)

    iframeRouteCleanupsRef.current[key] = () => {
      if (history.pushState === pushState) {
        history.pushState = originalPushState
      }
      if (history.replaceState === replaceState) {
        history.replaceState = originalReplaceState
      }
      iframeWindow.removeEventListener('popstate', notifyRouteChange)
      iframeWindow.removeEventListener('hashchange', notifyRouteChange)
      delete iframeRouteCleanupsRef.current[key]
    }
  }

  useLayoutEffect(() => {
    registerSandbox(props.id)

    const handleMessage = (event: MessageEvent<any>) => {
    const message = event.data;

    // console.log('handleMessage:', message)

    if (message?.type === '__LINGCHUANG_ROUTES__') {
      context.component?.actions.loaded({ pageList: message.routes.map((route) => {
        return {
          ...route,
          id: route.path,
          title: route.path
        }
      })})
    }
  };

  window.addEventListener('message', handleMessage);
  const onOpenPageCancel = localIframeEvents.on('openPage', ({ id }) => {
    if (!id) {
      return
    }

    const route = normalizeRoute(id)
    const hasRoute = Object.entries(iframeRefs.current).some(([key, iframe]) => {
      if (!iframe) {
        return iframeRoutesRef.current[key] === route
      }

      const currentRoute = getIframeRoute(iframe)
      if (currentRoute) {
        iframeRoutesRef.current[key] = currentRoute
      }
      return (currentRoute || iframeRoutesRef.current[key]) === route
    })

    if (hasRoute) {
      return
    }

    const key = `route-${nextIframeIdRef.current++}`
    iframeRoutesRef.current[key] = route
    setIframes((current) => current.concat({ key, route, srcRoute: route }))
  })

  return () => {
    window.removeEventListener('message', handleMessage);
    onOpenPageCancel()
  };
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        overflowX: 'auto',
        overflowY: 'hidden',
        gap: 200
      }}
    >
      {iframes.map((item) => {
        const src = item.srcRoute
          ? `${LOCAL_IFRAME_PATH}${item.srcRoute === '/' ? '' : item.srcRoute}`
          : LOCAL_IFRAME_PATH

        return (
          <iframe
            key={item.key}
            id={item.key === 'default' ? 'local-iframe' : `local-iframe-${item.key}`}
            ref={(element) => {
              iframeRefs.current[item.key] = element
              if (element) {
                iframeRoutesRef.current[item.key] = getIframeRoute(element) || item.route
              } else {
                iframeRouteCleanupsRef.current[item.key]?.()
                delete iframeRoutesRef.current[item.key]
              }
            }}
            src={src}
            style={{
              border: 'none',
              width: '100vw',
              height: '100vh'
            }}
            onLoad={(event) => {
              watchIframeRoute(item.key, event.currentTarget)
              syncIframeRoute(item.key, event.currentTarget, true)
              context.notifyChanged(...TEMP_TEST_NOTIFYCHANGED)
            }}
          />
        )
      })}
    </div>
  )
}

export default RuntimeIframe

const TEMP_TEST_NOTIFYCHANGED = [
  '/pricescreen',
  'update',
  {
    "events": [
        {
            "title": "onChange",
            "mermaid": "flowchart LR; A[\"点击分类标签\"] --> B[\"更新 selectedTag 状态\"]; B --> C[\"setSelectedTag([tag.categoryId])\"]",
            "description": "切换分类标签",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "CheckableTag",
                "startLine": 246,
                "endLine": 252
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":246,\"end\":252}']"
        },
        {
            "title": "onClick",
            "mermaid": "flowchart LR; A[\"点击查询按钮\"] --> B[\"pageChange(1, pageSize)\"]; B --> C[\"更新 params 分页状态\"]; C --> D[\"调用 getList 接口\"]; D --> E{\"接口返回是否有数据\"}; E -->|\"有数据\"| F[\"setPriceList + setTotal 更新列表\"]; E -->|\"无数据或失败\"| G[\"setPriceList([]) + setTotal(0)\"]",
            "description": "查询",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "Button",
                "startLine": 257,
                "endLine": 259
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":257,\"end\":259}']"
        },
        {
            "title": "onClick",
            "mermaid": "flowchart LR; A[\"点击重置按钮\"] --> B[\"重置表单字段\"]; B --> C[\"setParams 恢复默认分页\"]; C --> D[\"setSelectedTag([-1]) 恢复全部分类\"]; D --> E[\"调用 getList 接口重新查询\"]",
            "description": "重置",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "Button",
                "startLine": 260,
                "endLine": 262
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":260,\"end\":262}']"
        }
    ],
    "services": [
        {
            "title": "getConfig",
            "type": "up",
            "description": "页面初始化时拉取分类标签配置及数据最后更新时间",
            "refType": "page",
            "refSelector": "body"
        },
        {
            "title": "getList",
            "type": "up",
            "description": "页面初始化及查询/分页时拉取商品价格热度榜单列表",
            "refType": "page",
            "refSelector": "body"
        }
    ],
    "state": [
        {
            "field": "selectedTag",
            "description": "当前选中的一级分类标签，控制 CheckableTag 高亮状态",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "CheckableTag",
                "startLine": 246,
                "endLine": 252
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":246,\"end\":252}']"
        },
        {
            "field": "priceList",
            "description": "商品热度榜单列表数据，渲染到表格",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "Table",
                "startLine": 274,
                "endLine": 293
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":274,\"end\":293}']"
        },
        {
            "field": "total",
            "description": "列表总条数，用于分页展示",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "Table",
                "startLine": 274,
                "endLine": 293
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":274,\"end\":293}']"
        },
        {
            "field": "updateTime",
            "description": "数据最后更新时间，展示在商品列表区域右上角",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "div",
                "startLine": 269,
                "endLine": 271
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":269,\"end\":271}']"
        }
    ],
    "store": [
        {
            "field": "selectedTag",
            "description": "当前选中的一级分类标签，控制 CheckableTag 高亮状态",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "CheckableTag",
                "startLine": 246,
                "endLine": 252
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":246,\"end\":252}']"
        },
        {
            "field": "priceList",
            "description": "商品热度榜单列表数据，渲染到表格",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "Table",
                "startLine": 274,
                "endLine": 293
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":274,\"end\":293}']"
        },
        {
            "field": "total",
            "description": "列表总条数，用于分页展示",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "Table",
                "startLine": 274,
                "endLine": 293
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":274,\"end\":293}']"
        },
        {
            "field": "updateTime",
            "description": "数据最后更新时间，展示在商品列表区域右上角",
            "location": {
                "fileName": "src/pages/PriceScreen/index.tsx",
                "tag": "div",
                "startLine": 269,
                "endLine": 271
            },
            "refSelector": "[data-loc*='src/pages/PriceScreen/index.tsx'][data-loc*='\"codeLine\":{\"start\":269,\"end\":271}']"
        }
    ],
    "docs": []
}
]