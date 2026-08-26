import React, { useState, useLayoutEffect, useRef } from 'react'
import { registerSandbox, refreshLocalGraph } from './sandbox/forLocalIframe'
import context from './context'
import { Events } from "../utils/events";

export const localIframeEvents = new Events<{
	'openPage': { id: string }
}>();

const LOCAL_IFRAME_PATH = '/lingchuang'

const normalizeBasePath = (basePath: string) => {
	const normalized = basePath.trim()
	if (!normalized || normalized === '/') {
		return ''
	}
	const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
	return withLeadingSlash.replace(/\/+$/, '')
}

const routerBasename = normalizeBasePath(window.__LINGCHUANG_CONFIG__?.router?.basename || '')
const iframeRouteBasePath = routerBasename || LOCAL_IFRAME_PATH

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
		if (!pathname || (iframeRouteBasePath
			? pathname === iframeRouteBasePath || pathname === `${iframeRouteBasePath}/`
			: pathname === '/')) {
			return '/'
		}
		const route = iframeRouteBasePath && pathname.startsWith(`${iframeRouteBasePath}/`)
			? pathname.slice(iframeRouteBasePath.length) || '/'
			: pathname
		console.log('normalizeRoute(route)', normalizeRoute(route))
		return normalizeRoute(route)
	} catch {
		// 跨源 iframe 无法读取 location，使用 load 时记录的路由兜底。
		return null
	}
}

const RuntimeIframe = (props) => {
	const [iframes, setIframes] = useState<{route: string}[]>(() => [{ route: '/' }])
	const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({})
	const iframeRoutesRef = useRef<Record<string, string>>({})
	const iframeRouteCleanupsRef = useRef<Record<string, (() => void) | undefined>>({})
	const [debugRoute, setDebugRoute] = useState('')

	const syncIframeRoute = (routeKey: string, iframe: HTMLIFrameElement, notify = false) => {
		const route = getIframeRoute(iframe)
		if (!route) {
			return
		}

		const previousRoute = iframeRoutesRef.current[routeKey] || routeKey
		// 保留旧 route 索引，直到旧 iframe 的 ref 被清理，避免连续 history 事件重复通知。
		iframeRoutesRef.current[routeKey] = route
		iframeRoutesRef.current[route] = route
		setIframes((current) => {
			let changed = false
			const next = current.map((item) => {
				if (item.route !== routeKey || item.route === route) {
					return item
				}
				changed = true
				return { route }
			})
			return changed ? next : current
		})

		if (notify || previousRoute !== route) {
			props.onIframeDestory(previousRoute)
			props.onIframeLoad({
				id: route,
				doc: iframe.contentDocument
			})
		}
	}

	const watchIframeRoute = (routeKey: string, iframe: HTMLIFrameElement) => {
		iframeRouteCleanupsRef.current[routeKey]?.()

		const iframeWindow = iframe.contentWindow
		if (!iframeWindow) {
			return
		}

		const history = iframeWindow.history
		const originalPushState = history.pushState
		const originalReplaceState = history.replaceState
		const notifyRouteChange = () => {
			// 路由库通常会在 history 调用后再更新 DOM，放到微任务中读取最终地址。
			Promise.resolve().then(() => syncIframeRoute(routeKey, iframe))
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

		iframeRouteCleanupsRef.current[routeKey] = () => {
			if (history.pushState === pushState) {
				history.pushState = originalPushState
			}
			if (history.replaceState === replaceState) {
				history.replaceState = originalReplaceState
			}
			iframeWindow.removeEventListener('popstate', notifyRouteChange)
			iframeWindow.removeEventListener('hashchange', notifyRouteChange)
			delete iframeRouteCleanupsRef.current[routeKey]
		}
	}

	useLayoutEffect(() => {
		registerSandbox(props.id)

		const handleMessage = (event: MessageEvent<any>) => {
			const message = event.data;

			// console.log('handleMessage:', message)

			if (message?.type === '__LINGCHUANG_ROUTES__') {
				context.component?.actions.loaded({
					pageList: message.routes.map((route) => {
						return {
							...route,
							id: route.path,
							title: route.path
						}
					})
				})
			}
		};

		window.addEventListener('message', handleMessage);
		const onOpenPageCancel = localIframeEvents.on('openPage', ({ id }) => {
			if (!id) {
				return
			}

			const route = normalizeRoute(id)
			const hasRoute = route in iframeRoutesRef.current || Object.entries(iframeRefs.current).some(([routeKey, iframe]) => {
				if (!iframe) {
					return routeKey === route
				}

				const currentRoute = getIframeRoute(iframe)
				return (currentRoute || iframeRoutesRef.current[routeKey] || routeKey) === route
			})

			if (hasRoute) {
				return
			}

			iframeRoutesRef.current[route] = route
			setIframes((current) => current.some((item) => item.route === route)
				? current
				: current.concat({ route }))
		})

		const events = context.component!.events;

		const onEventsDebugTargetCancel = events.on('debugTarget', ({ route }) => {
			setDebugRoute(route)
		})

		return () => {
			window.removeEventListener('message', handleMessage);
			onOpenPageCancel()
			onEventsDebugTargetCancel()
		};
	}, [])

	console.log('iframes', iframes)

	return (
		<>
			{iframes.map((item) => {
				// const src = `${LOCAL_IFRAME_PATH}${item.route === '/' ? '' : item.route}`
				const src = `${window.location.origin}${routerBasename}${item.route === '/' ? '' : item.route}`

				return (
					<div
						key={item.route}
						style={{
							width: '1440px',
							height: '100vh',
							visibility: debugRoute ? (item.route === debugRoute ? 'visible' : 'hidden') : 'visible'
						}}
						data-zone-type="page"
						data-zone-kind="iframe"
						data-zone-title={item.route}
					>
						<iframe
							id={item.route === '/' ? 'local-iframe' : `local-iframe-${item.route}`}
							ref={(element) => {
								iframeRefs.current[item.route] = element
								if (element) {
									iframeRoutesRef.current[item.route] = getIframeRoute(element) || item.route
								} else {
									iframeRouteCleanupsRef.current[item.route]?.()
									delete iframeRefs.current[item.route]
									delete iframeRoutesRef.current[item.route]
								}
							}}
							src={src}
							style={{
								border: 'none',
								width: '100%',
								height: '100%'
							}}
							onLoad={(event) => {
								watchIframeRoute(item.route, event.currentTarget)
								syncIframeRoute(item.route, event.currentTarget, true)
								// context.notifyChanged(...TEMP_TEST_NOTIFYCHANGED)
								// context.notifyChanged(...TEMP_TEST_NOTIFYCHANGED2)
							}}
						/>
					</div>
				)
			})}
		</>
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

const TEMP_TEST_NOTIFYCHANGED2 = [
	'/productpool',
	'update',
	{
		"events": [
			{
				"title": "onChange",
				"mermaid": "flowchart LR; A[\"用户点击 Tab\"] --> B[\"更新 activeTab 状态\"]; B --> C{\"activeTab 值\"}; C -->|\"1\"| D[\"展示商品池管理面板\"]; C -->|\"2\"| E[\"展示规则组管理面板\"]",
				"description": "切换 Tab 面板",
				"location": {
					"fileName": "src/pages/ProductPoolManage/index.tsx",
					"tag": "Tabs",
					"startLine": 17,
					"endLine": 25
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/index.tsx'][data-loc*='\"codeLine\":{\"start\":17,\"end\":25}']"
			},
			{
				"title": "onClick",
				"mermaid": "flowchart LR; A[\"点击新建商品池\"] --> B[\"打开新建商品池弹窗（InvestmentPool）\"]",
				"description": "新建商品池",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Button",
					"startLine": 517,
					"endLine": 519
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":517,\"end\":519}']"
			},
			{
				"title": "onClick",
				"mermaid": "flowchart LR; A[\"点击编辑\"] --> B[\"加载该行商品池详情\"] --> C[\"打开编辑商品池弹窗（InvestmentPool）\"]",
				"description": "编辑商品池",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Button",
					"startLine": 631,
					"endLine": 633
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":631,\"end\":633}']"
			},
			{
				"title": "onClick",
				"mermaid": "flowchart LR; A[\"点击查看任务详情\"] --> B[\"调用 queryItemPoolTaskInfo 加载任务概览\"] --> C[\"打开任务详情弹窗（DetailModal）\"]",
				"description": "查看任务详情",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Button",
					"startLine": 658,
					"endLine": 667
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":658,\"end\":667}']"
			},
			{
				"title": "onClick",
				"mermaid": "flowchart LR; A[\"点击领取任务\"] --> B[\"打开领取任务弹窗（ReceiveModal）\"]",
				"description": "领取任务",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Button",
					"startLine": 668,
					"endLine": 674
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":668,\"end\":674}']"
			},
			{
				"title": "onConfirm",
				"mermaid": "flowchart LR; A[\"点击删除并确认\"] --> B{\"poolTaskStatus 是否允许删除\"}; B -->|\"允许\"| C[\"调用 postUpdateItemPoolItemInfo 执行删除\"]; B -->|\"不允许\"| D[\"按钮禁用，不触发\"]",
				"description": "删除商品池确认",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Popconfirm",
					"startLine": 640,
					"endLine": 655
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":640,\"end\":655}']"
			},
			{
				"title": "pagination.onChange",
				"mermaid": "flowchart LR; A[\"切换页码或每页条数\"] --> B[\"更新分页参数\"] --> C[\"重新请求商品池列表\"]",
				"description": "切换分页",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Table",
					"startLine": 800,
					"endLine": 818
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":800,\"end\":818}']"
			},
			{
				"title": "onOk",
				"mermaid": "flowchart LR; A[\"点击确认保存\"] --> B[\"表单校验\"]; B -->|\"通过\"| C{\"操作类型\"}; C -->|\"新建\"| D[\"调用新建接口创建商品池\"]; C -->|\"编辑\"| E[\"调用编辑接口更新商品池\"]; D --> F[\"关闭弹窗并刷新列表\"]; E --> F; B -->|\"不通过\"| G[\"展示校验错误提示\"]",
				"description": "提交保存商品池",
				"location": {
					"fileName": "src/pages/ProductPool/InvestmentPool.tsx",
					"tag": "Modal",
					"startLine": 354,
					"endLine": 727
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/InvestmentPool.tsx'][data-loc*='\"codeLine\":{\"start\":354,\"end\":727}']"
			},
			{
				"title": "onCancel",
				"mermaid": "flowchart LR; A[\"点击取消\"] --> B[\"关闭弹窗，不保存任何修改\"]",
				"description": "取消并关闭弹窗",
				"location": {
					"fileName": "src/pages/ProductPool/InvestmentPool.tsx",
					"tag": "Modal",
					"startLine": 354,
					"endLine": 727
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/InvestmentPool.tsx'][data-loc*='\"codeLine\":{\"start\":354,\"end\":727}']"
			},
			{
				"title": "onOk",
				"mermaid": "flowchart LR; A[\"点击确认\"] --> B[\"表单校验\"]; B -->|\"通过\"| C[\"调用 postAddTaskClaimConfig 保存配置\"]; C --> D[\"关闭弹窗\"]; B -->|\"不通过\"| E[\"提示校验错误\"]",
				"description": "确认保存领取配置",
				"location": {
					"fileName": "src/pages/ProductPool/components/receiveModal/index.tsx",
					"tag": "Modal",
					"startLine": 105,
					"endLine": 207
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/receiveModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":105,\"end\":207}']"
			},
			{
				"title": "onCancel",
				"mermaid": "flowchart LR; A[\"点击取消\"] --> B[\"关闭弹窗，不保存\"]",
				"description": "取消领取配置",
				"location": {
					"fileName": "src/pages/ProductPool/components/receiveModal/index.tsx",
					"tag": "Modal",
					"startLine": 105,
					"endLine": 207
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/receiveModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":105,\"end\":207}']"
			},
			{
				"title": "onConfirm",
				"mermaid": "flowchart LR; A[\"点击确认回收\"] --> B[\"调用 postReCycledTask 执行回收\"] --> C[\"刷新列表并关闭弹窗\"]",
				"description": "确认回收任务",
				"location": {
					"fileName": "src/pages/ProductPool/components/recoveryModal/index.tsx",
					"tag": "Popconfirm",
					"startLine": 88,
					"endLine": 99
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/recoveryModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":88,\"end\":99}']"
			},
			{
				"title": "onOk",
				"mermaid": "flowchart LR; A[\"点击确认\"] --> B[\"表单校验\"]; B -->|\"通过\"| C[\"调用 updatePoolStatus 保存规则\"]; C --> D[\"关闭弹窗并刷新\"]; B -->|\"不通过\"| E[\"提示校验错误\"]",
				"description": "保存任务规则",
				"location": {
					"fileName": "src/pages/ProductPool/components/taskRulesModal/index.tsx",
					"tag": "Modal",
					"startLine": 163,
					"endLine": 278
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/taskRulesModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":163,\"end\":278}']"
			},
			{
				"title": "onCancel",
				"mermaid": "flowchart LR; A[\"点击取消\"] --> B[\"关闭弹窗，不保存\"]",
				"description": "取消任务规则配置",
				"location": {
					"fileName": "src/pages/ProductPool/components/taskRulesModal/index.tsx",
					"tag": "Modal",
					"startLine": 163,
					"endLine": 278
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/taskRulesModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":163,\"end\":278}']"
			},
			{
				"title": "onClick",
				"mermaid": "flowchart LR; A[\"点击导出\"] --> B[\"收集当前查询参数\"] --> C[\"调用 downloadRuleGroup 接口\"] --> D{\"请求结果\"}; D -->|\"成功\"| E[\"提示导出成功\"]; D -->|\"失败\"| F[\"控制台输出错误\"]",
				"description": "导出列表数据",
				"location": {
					"fileName": "src/pages/ProductPoolManage/RuleGroup/index.tsx",
					"tag": "Button",
					"startLine": 419,
					"endLine": 445
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/RuleGroup/index.tsx'][data-loc*='\"codeLine\":{\"start\":419,\"end\":445}']"
			},
			{
				"title": "onClick",
				"mermaid": "flowchart LR; A[\"点击新增规则组\"] --> B[\"重置表单\"] --> C[\"打开新增规则组弹窗（ActionModal）\"]",
				"description": "新增规则组",
				"location": {
					"fileName": "src/pages/ProductPoolManage/RuleGroup/index.tsx",
					"tag": "Button",
					"startLine": 448,
					"endLine": 460
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/RuleGroup/index.tsx'][data-loc*='\"codeLine\":{\"start\":448,\"end\":460}']"
			},
			{
				"title": "onClick",
				"mermaid": "flowchart LR; A[\"点击编辑规则组\"] --> B[\"将当前行数据填入表单\"] --> C[\"打开编辑规则组弹窗（ActionModal）\"]",
				"description": "编辑规则组",
				"location": {
					"fileName": "src/pages/ProductPoolManage/RuleGroup/index.tsx",
					"tag": "Button",
					"startLine": 162,
					"endLine": 181
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/RuleGroup/index.tsx'][data-loc*='\"codeLine\":{\"start\":162,\"end\":181}']"
			},
			{
				"title": "onClick",
				"mermaid": "flowchart LR; A[\"点击删除规则组\"] --> B[\"弹出二次确认对话框\"]; B -->|\"确认\"| C[\"调用 deleteRuleGroup 删除\"]; C --> D[\"提示删除成功并刷新列表\"]; B -->|\"取消\"| E[\"不执行任何操作\"]",
				"description": "删除规则组",
				"location": {
					"fileName": "src/pages/ProductPoolManage/RuleGroup/index.tsx",
					"tag": "Button",
					"startLine": 182,
					"endLine": 209
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/RuleGroup/index.tsx'][data-loc*='\"codeLine\":{\"start\":182,\"end\":209}']"
			},
			{
				"title": "onOk",
				"mermaid": "flowchart LR; A[\"点击确认\"] --> B[\"表单校验\"]; B -->|\"通过\"| C{\"操作类型\"}; C -->|\"新增\"| D[\"调用 createRuleGroup 创建规则组\"]; C -->|\"编辑\"| E[\"调用 updateRuleGroup 更新规则组\"]; D --> F[\"提示成功并关闭弹窗\"]; E --> F; B -->|\"不通过\"| G[\"显示校验错误\"]",
				"description": "确认保存规则组",
				"location": {
					"fileName": "src/pages/ProductPoolManage/components/ActionModal.tsx",
					"tag": "Modal",
					"startLine": 82,
					"endLine": 163
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/components/ActionModal.tsx'][data-loc*='\"codeLine\":{\"start\":82,\"end\":163}']"
			},
			{
				"title": "onCancel",
				"mermaid": "flowchart LR; A[\"点击取消\"] --> B[\"关闭弹窗，不保存\"]",
				"description": "关闭弹窗",
				"location": {
					"fileName": "src/pages/ProductPoolManage/components/ActionModal.tsx",
					"tag": "Modal",
					"startLine": 82,
					"endLine": 163
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/components/ActionModal.tsx'][data-loc*='\"codeLine\":{\"start\":82,\"end\":163}']"
			},
			{
				"title": "customRequest",
				"mermaid": "flowchart LR; A[\"选择文件上传\"] --> B{\"文件类型校验\"}; B -->|\"不是 xls/xlsx\"| C[\"提示文件类型不符\"]; B -->|\"通过\"| D[\"上传文件获取 metadata\"]; D --> E[\"换取 blobstoreKey 保存为 uploadKey\"]; D -->|\"失败\"| F[\"提示上传错误\"]",
				"description": "上传 Excel 文件",
				"location": {
					"fileName": "src/pages/ProductPoolManage/components/ActionModal.tsx",
					"tag": "Upload",
					"startLine": 147,
					"endLine": 156
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/components/ActionModal.tsx'][data-loc*='\"codeLine\":{\"start\":147,\"end\":156}']"
			},
			{
				"title": "onClick",
				"mermaid": "flowchart LR; A[\"点击展开或收起\"] --> B[\"切换 isExpanded 状态\"] --> C{\"isExpanded\"}; C -->|\"true\"| D[\"展示完整商品池名称列表\"]; C -->|\"false\"| E[\"折叠显示部分名称\"]",
				"description": "展开/收起商品池名称",
				"location": {
					"fileName": "src/pages/ProductPoolManage/components/ProductPoolCell.tsx",
					"tag": "L",
					"startLine": 26,
					"endLine": 28
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/components/ProductPoolCell.tsx'][data-loc*='\"codeLine\":{\"start\":26,\"end\":28}']"
			}
		],
		"services": [
			{
				"title": "API.getProductList",
				"type": "up",
				"description": "初始化及查询时加载商品池列表数据",
				"refType": "component",
				"refSelector": "body"
			},
			{
				"title": "API.queryItemPoolConstant",
				"type": "up",
				"description": "初始化时加载商品池枚举常量（池类型、状态、优先级等）",
				"refType": "component",
				"refSelector": "body"
			},
			{
				"title": "getCompetitorPlatformList",
				"type": "up",
				"description": "初始化时加载竞品对比平台列表",
				"refType": "component",
				"refSelector": "body"
			},
			{
				"title": "queryRadarCopyWriting",
				"type": "up",
				"description": "初始化时加载文案配置",
				"refType": "component",
				"refSelector": "body"
			},
			{
				"title": "API.getSiftList",
				"type": "up",
				"description": "加载筛选包数据供选择",
				"refType": "popup",
				"location": {
					"fileName": "src/pages/ProductPool/InvestmentPool.tsx",
					"tag": "Select",
					"startLine": 422,
					"endLine": 431
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/InvestmentPool.tsx'][data-loc*='\"codeLine\":{\"start\":422,\"end\":431}']"
			},
			{
				"title": "API.queryMarketSubList",
				"type": "up",
				"description": "加载子活动列表",
				"refType": "popup",
				"location": {
					"fileName": "src/pages/ProductPool/InvestmentPool.tsx",
					"tag": "Select",
					"startLine": 440,
					"endLine": 450
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/InvestmentPool.tsx'][data-loc*='\"codeLine\":{\"start\":440,\"end\":450}']"
			},
			{
				"title": "API.queryMarketActivityList",
				"type": "up",
				"description": "加载营销活动列表",
				"refType": "popup",
				"location": {
					"fileName": "src/pages/ProductPool/InvestmentPool.tsx",
					"tag": "Select",
					"startLine": 459,
					"endLine": 469
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/InvestmentPool.tsx'][data-loc*='\"codeLine\":{\"start\":459,\"end\":469}']"
			},
			{
				"title": "getRuleGroupList",
				"type": "up",
				"description": "加载可关联的规则组列表",
				"refType": "popup",
				"location": {
					"fileName": "src/pages/ProductPool/InvestmentPool.tsx",
					"tag": "Select",
					"startLine": 677,
					"endLine": 695
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/InvestmentPool.tsx'][data-loc*='\"codeLine\":{\"start\":677,\"end\":695}']"
			},
			{
				"title": "API.queryItemPoolConstant",
				"type": "up",
				"description": "初始化时加载商品池枚举常量",
				"refType": "popup",
				"refSelector": "body"
			},
			{
				"title": "getCompetitorPlatformList",
				"type": "up",
				"description": "初始化时加载竞品平台列表",
				"refType": "popup",
				"refSelector": "body"
			},
			{
				"title": "API.queryItemPoolTaskInfo",
				"type": "up",
				"description": "打开弹窗时加载该商品池的任务详情数据",
				"refType": "popup",
				"refSelector": "body"
			},
			{
				"title": "API.postAddTaskClaimConfig",
				"type": "up",
				"description": "提交保存任务领取配置",
				"refType": "popup",
				"location": {
					"fileName": "src/pages/ProductPool/components/receiveModal/index.tsx",
					"tag": "Modal",
					"startLine": 105,
					"endLine": 207
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/receiveModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":105,\"end\":207}']"
			},
			{
				"title": "queryReCycledTask",
				"type": "up",
				"description": "打开弹窗时加载可回收的任务列表",
				"refType": "popup",
				"refSelector": "body"
			},
			{
				"title": "postReCycledTask",
				"type": "up",
				"description": "用户确认回收后执行回收请求",
				"refType": "popup",
				"location": {
					"fileName": "src/pages/ProductPool/components/recoveryModal/index.tsx",
					"tag": "Popconfirm",
					"startLine": 88,
					"endLine": 99
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/recoveryModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":88,\"end\":99}']"
			},
			{
				"title": "API.updatePoolStatus",
				"type": "up",
				"description": "提交保存任务规则配置，同步更新池状态",
				"refType": "popup",
				"location": {
					"fileName": "src/pages/ProductPool/components/taskRulesModal/index.tsx",
					"tag": "Modal",
					"startLine": 163,
					"endLine": 278
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/taskRulesModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":163,\"end\":278}']"
			},
			{
				"title": "API.queryRuleGroup",
				"type": "up",
				"description": "查询规则组列表数据",
				"refType": "component",
				"refSelector": "body"
			},
			{
				"title": "queryItemPoolConstant",
				"type": "up",
				"description": "初始化时加载平台和店铺过滤枚举常量",
				"refType": "component",
				"refSelector": "body"
			}
		],
		"state": [
			{
				"field": "activeTab",
				"description": "当前选中的 Tab，切换商品池管理与规则组管理两个面板",
				"location": {
					"fileName": "src/pages/ProductPoolManage/index.tsx",
					"tag": "Tabs",
					"startLine": 17,
					"endLine": 25
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/index.tsx'][data-loc*='\"codeLine\":{\"start\":17,\"end\":25}']"
			},
			{
				"field": "productPoolList",
				"description": "商品池列表数据，渲染在主表格中",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Table",
					"startLine": 800,
					"endLine": 818
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":800,\"end\":818}']"
			},
			{
				"field": "total",
				"description": "商品池总数，用于分页显示",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Table",
					"startLine": 800,
					"endLine": 818
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":800,\"end\":818}']"
			},
			{
				"field": "poolTaskInfoDetail",
				"description": "任务概览数据，渲染弹窗中的任务统计表格",
				"location": {
					"fileName": "src/pages/ProductPool/components/detailModal/index.tsx",
					"tag": "Modal",
					"startLine": 100,
					"endLine": 140
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/detailModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":100,\"end\":140}']"
			},
			{
				"field": "recycledTaskList",
				"description": "可回收任务列表，渲染在弹窗表格中",
				"location": {
					"fileName": "src/pages/ProductPool/components/recoveryModal/index.tsx",
					"tag": "Table",
					"startLine": 123,
					"endLine": 131
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/recoveryModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":123,\"end\":131}']"
			},
			{
				"field": "isExpanded",
				"description": "控制商品池名称列表是否展开显示",
				"location": {
					"fileName": "src/pages/ProductPoolManage/components/ProductPoolCell.tsx",
					"tag": "L",
					"startLine": 26,
					"endLine": 28
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/components/ProductPoolCell.tsx'][data-loc*='\"codeLine\":{\"start\":26,\"end\":28}']"
			}
		],
		"store": [
			{
				"field": "activeTab",
				"description": "当前选中的 Tab，切换商品池管理与规则组管理两个面板",
				"location": {
					"fileName": "src/pages/ProductPoolManage/index.tsx",
					"tag": "Tabs",
					"startLine": 17,
					"endLine": 25
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/index.tsx'][data-loc*='\"codeLine\":{\"start\":17,\"end\":25}']"
			},
			{
				"field": "productPoolList",
				"description": "商品池列表数据，渲染在主表格中",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Table",
					"startLine": 800,
					"endLine": 818
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":800,\"end\":818}']"
			},
			{
				"field": "total",
				"description": "商品池总数，用于分页显示",
				"location": {
					"fileName": "src/pages/ProductPool/index.tsx",
					"tag": "Table",
					"startLine": 800,
					"endLine": 818
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/index.tsx'][data-loc*='\"codeLine\":{\"start\":800,\"end\":818}']"
			},
			{
				"field": "poolTaskInfoDetail",
				"description": "任务概览数据，渲染弹窗中的任务统计表格",
				"location": {
					"fileName": "src/pages/ProductPool/components/detailModal/index.tsx",
					"tag": "Modal",
					"startLine": 100,
					"endLine": 140
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/detailModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":100,\"end\":140}']"
			},
			{
				"field": "recycledTaskList",
				"description": "可回收任务列表，渲染在弹窗表格中",
				"location": {
					"fileName": "src/pages/ProductPool/components/recoveryModal/index.tsx",
					"tag": "Table",
					"startLine": 123,
					"endLine": 131
				},
				"refSelector": "[data-loc*='src/pages/ProductPool/components/recoveryModal/index.tsx'][data-loc*='\"codeLine\":{\"start\":123,\"end\":131}']"
			},
			{
				"field": "isExpanded",
				"description": "控制商品池名称列表是否展开显示",
				"location": {
					"fileName": "src/pages/ProductPoolManage/components/ProductPoolCell.tsx",
					"tag": "L",
					"startLine": 26,
					"endLine": 28
				},
				"refSelector": "[data-loc*='src/pages/ProductPoolManage/components/ProductPoolCell.tsx'][data-loc*='\"codeLine\":{\"start\":26,\"end\":28}']"
			}
		],
		"docs": []
	}
]
