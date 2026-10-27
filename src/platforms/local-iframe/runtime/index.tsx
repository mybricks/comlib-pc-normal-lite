import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { registerSandbox } from '../sandbox'
import context from '../../../mix/context'
import myContext from '../context'
import Xterm from '../../../components/xterm'
import { useDarkMode } from '../../../utils/hooks'
import { agentTurnLifecycle } from '../../../mix/sandbox/agent-turn-lifecycle'

type RouteParamDraft = {
  key: string
  value: string
}

const WAITING_RUNTIME_OUTPUT = '正在等待项目运行时启动…\n'

const TERMINAL_OPTIONS = {
	fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
	fontSize: 13,
	lineHeight: 1.5,
	letterSpacing: 0.1,
}

const TERMINAL_THEMES = {
	light: {
		background: '#ffffff', foreground: '#24292f', selectionBackground: '#cce5ff',
		black: '#24292f', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700',
		blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#f6f8fa', brightBlack: '#57606a',
	},
	dark: {
		background: '#1f2328', foreground: '#f0f6fc', selectionBackground: 'rgba(56, 139, 253, 0.38)',
		black: '#484f58', red: '#ff7b72', green: '#7ee787', yellow: '#e3b341',
		blue: '#79c0ff', magenta: '#d2a8ff', cyan: '#76e3ea', white: '#b1bac4', brightBlack: '#8b949e',
	},
}

/** ProjectRuntime 的日志终端。所有启动入口都只订阅同一条 runtimeUpdate 流。 */
function ProjectRuntimeTerminal({ componentId }: { componentId?: string }) {
	const [output, setOutput] = useState(() => myContext.runtime.getSnapshot().output || WAITING_RUNTIME_OUTPUT)
	const [status, setStatus] = useState<'starting' | 'ready' | 'stopping' | 'error' | 'stopped'>(() => myContext.runtime.getSnapshot().status?.state || 'starting')
	const [agentRequestState, setAgentRequestState] = useState<'idle' | 'processing' | 'finished-without-url'>('idle')
	const runtimeUrlReceivedRef = useRef(false)
	const isDark = useDarkMode()
	const terminalOptions = useMemo(() => ({
		...TERMINAL_OPTIONS,
		theme: isDark ? TERMINAL_THEMES.dark : TERMINAL_THEMES.light,
	}), [isDark])
	const projectPath = (window as any).__LINGCHUANG_CONFIG__?.projectDirectory
		?? (window as any).__LINGCHUANG_CONFIG__?.projectPath
		?? '项目运行日志'

	useEffect(() => {
		return myContext.runtime.events.on('runtimeUpdate', (update) => {
			if (!update.logOnly) {
				setStatus(update.status.state)
				if (update.status.state === 'ready' && update.status.url) {
					runtimeUrlReceivedRef.current = true
				}
				if (update.status.state === 'starting') {
					runtimeUrlReceivedRef.current = false
					setAgentRequestState((current) => current === 'processing' ? current : 'idle')
				}
			}
			setOutput(myContext.runtime.getSnapshot().output || WAITING_RUNTIME_OUTPUT)
		})
	}, [])

	const sendErrorToAgent = useCallback(() => {
		const sendToAgent = (window as any)._sandbox_?.helpers?.sendToAgent
		if (typeof sendToAgent !== 'function' || !componentId) return
		runtimeUrlReceivedRef.current = false
		setAgentRequestState('processing')
		// 与 @updateDoc 一致：不依赖 sendToAgent 的返回值，而是通过 sandbox 的
		// beforeTurn/afterTurn hooks 等待这一次 Agent 请求完成。
		agentTurnLifecycle.register(componentId, () => {
			// Agent 结束不代表项目恢复；只有 Runtime 交付 ready URL 才算成功。
			if (!runtimeUrlReceivedRef.current) setAgentRequestState('finished-without-url')
		})
		sendToAgent(componentId, { message: '项目启动失败了，请处理下。' })
	}, [componentId])

	// data-zone-type=ai-request：与 plugin-ai Sender 相同，告诉画布不要代理指针事件，
	// 否则 xterm 滚动/选中会被设计器当成选区。
	return (
		<div
			data-zone-type="ai-request"
			style={{
				width: '100%',
				height: '100%',
				boxSizing: 'border-box',
				padding: '16px 18px',
				background: 'var(--mybricks-bg-color-main)',
			}}
		>
			<div style={{
				display: 'flex',
				flexDirection: 'column',
				width: '100%',
				height: '100%',
			}}>
				<div style={{
					padding: '0 0 10px',
					borderBottom: '1px solid var(--mybricks-border-color-main)',
					color: 'var(--mybricks-text-color-main)',
					fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
					fontSize: 12,
					lineHeight: '18px',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}>
					{projectPath}
				</div>
				{status === 'error' && (
					<div style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: 16,
						marginTop: 12,
						padding: '8px 10px',
						border: '1px solid rgba(207, 34, 46, 0.28)',
						borderRadius: 4,
						background: isDark ? 'rgba(255, 123, 114, 0.1)' : 'rgba(207, 34, 46, 0.06)',
					}}>
						<div style={{ minWidth: 0, color: 'var(--mybricks-text-color-main)', fontSize: 12, lineHeight: 1.45 }}>
							{agentRequestState === 'processing' && 'AI 正在处理，等待项目运行时重新启动。'}
							{agentRequestState === 'finished-without-url' && '项目尚未启动，可继续让 AI 排查。'}
							{agentRequestState === 'idle' && '启动未完成。可交给 AI 继续处理。'}
						</div>
						{agentRequestState !== 'processing' && <button
							type="button"
							data-zone-type="ai-fixed"
							onClick={sendErrorToAgent}
							disabled={!componentId}
							style={{
								flex: 'none',
								padding: '6px 10px',
								border: 0,
								borderRadius: 4,
								background: 'var(--mybricks-color-primary, #fa6400)',
								color: '#fff',
								cursor: componentId ? 'pointer' : 'not-allowed',
								fontSize: 12,
								fontWeight: 700,
							}}
						>{agentRequestState === 'finished-without-url' ? '继续让 AI 排查' : '交给 AI 排查'}</button>}
					</div>
				)}
				<div style={{ flex: 1, minHeight: 0, paddingTop: 12 }}>
					<Xterm output={output} options={terminalOptions} />
				</div>
			</div>
		</div>
	)
}

function buildItemPath(path: string, params: RouteParamDraft[] = []) {
  const filteredParams = params.filter((param) => param.key)
  if (!path) return ''
  if (!filteredParams.length) return path
  const query = filteredParams
    .map((param) => {
      const key = encodeURIComponent(param.key)
      const value = encodeURIComponent(param.value)
      return `${key}=${value}`
    })
    .join('&')
  return `${path}?${query}`
}

const normalizeBasePath = (basePath: string) => {
	const normalized = basePath.trim()
	if (!normalized || normalized === '/') {
		return ''
	}
	const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
	return withLeadingSlash.replace(/\/+$/, '')
}

const buildIframeSrc = (itemSrc: string, runtimeUrl?: string) => {
	const routerBasename = normalizeBasePath(window.__LINGCHUANG_CONFIG__?.router?.basename || '')
	const origin = runtimeUrl ? new URL(runtimeUrl).origin : window.location.origin
	return `${origin}${routerBasename}${itemSrc === '/' ? '' : itemSrc}`
}

type RuntimeIframeItem = {
	title: string
	path: string
	params?: unknown[]
	src: string
}

type RuntimeRouteEventItem = {
	title: string
	path: string
	params?: {key: string; value: string}[]
}

const RuntimeIframe = (props) => {
	const [iframes, setIframes] = useState<RuntimeIframeItem[]>([])
	const [debugSrc, setDebugSrc] = useState('')
	const [runtimeUrl, setRuntimeUrl] = useState('')
	const runtimeUrlRef = useRef('')
	const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({})
	const pendingRefreshSrcRef = useRef('')
	const debugSrcRef = useRef('')
	const loadedSrcsRef = useRef<Set<string>>(new Set())
	const prevIframesRef = useRef<RuntimeIframeItem[]>([])
	const currentIframesRef = useRef<RuntimeIframeItem[]>([])
	const lastLoadedSignatureRef = useRef('')
	currentIframesRef.current = iframes
	const [ready, setReady] = useState(false)

	const emitLoadedIfReady = useCallback((nextIframes: RuntimeIframeItem[]) => {
		if (!nextIframes.every((item) => loadedSrcsRef.current.has(item.src))) {
			return
		}

		const signature = JSON.stringify(nextIframes.map((route) => {
			return {
				title: route.title,
				path: route.path,
				params: route.params,
				src: route.src
			}
		}))

		if (signature === lastLoadedSignatureRef.current) {
			return
		}

		lastLoadedSignatureRef.current = signature
		myContext.comment.notifyChanged()
		context.component?.actions.loaded?.({
			pageList: nextIframes.map((route) => {
				return {
					...route,
					id: route.src,
					routerPath: route.src,
					fileName: route.src,
				}
			})
		})
	}, [])

	const refreshIframe = useCallback((itemSrc: string) => {
		const iframe = iframeRefs.current[itemSrc]
		if (!iframe) return false

		const expectedSrc = buildIframeSrc(itemSrc, runtimeUrlRef.current)

		try {
			// 替换 iframe 的历史记录，使刷新后回到初始路由且无法回退到 iframe 内的旧页面。
			const contentWindow = iframe.contentWindow
			if (contentWindow) {
				contentWindow.location.replace(expectedSrc)
			} else {
				iframe.src = expectedSrc
			}
			return true
		} catch {
			iframe.src = expectedSrc
			return true
		}
	}, [])

	useEffect(() => {
		registerSandbox(props.id)

		const routesEvents = (window as any).__APP__?.routesEvents
		const cancelRoutesEventsRoutes = routesEvents?.on?.('routes', (routes: RuntimeRouteEventItem[]) => {
			const nextRoutes = routes.map((route) => {
				return {
					...route,
					src: buildItemPath(route.path, route.params)
				}
			})

			setIframes(nextRoutes)
		}) ?? (() => {})

		const onEventsDebugTargetCancel = myContext.debug.events.on('debugTarget', (props) => {
			const nextSrc = props.src || ''
			const previousSrc = debugSrcRef.current
			pendingRefreshSrcRef.current = nextSrc || previousSrc
			debugSrcRef.current = nextSrc
			setDebugSrc(nextSrc)
		})

		const onEventsRefreshTargetCancel = myContext.refresh.events.on('refreshTarget', (props) => {
			const refreshSrc = props.src || ''
			if (!refreshSrc) return

			refreshIframe(refreshSrc)
		})

		const onRuntimeUrlCancel = myContext.runtime.events.on('runtimeUrl', ({ url }) => {
			runtimeUrlRef.current = url
			setRuntimeUrl(url)
			setReady(true)
		})

		const onRuntimeUpdateCancel = myContext.runtime.events.on('runtimeUpdate', (update) => {
			// 每次真实项目进程重新进入启动阶段，都先切回同一块 Xterm，持续展示
			// ProjectRuntime 输出；ready 事件携带 URL 后再切回画布。
			if (update.status.state === 'starting') setReady(false)
		})

		// 兼容逻辑
		if (!(window as any).__APP__?.projectRuntime) {
			// 老项目，直接 ready
			setReady(true)
		}

		return () => {
			prevIframesRef.current.forEach((item) => {
				props.onIframeDestory?.(item.src)
			})
			cancelRoutesEventsRoutes()
			onEventsDebugTargetCancel()
			onEventsRefreshTargetCancel()
			onRuntimeUrlCancel()
			onRuntimeUpdateCancel()
		}
	}, [])

	useEffect(() => {
		const targetSrc = pendingRefreshSrcRef.current
		if (!targetSrc) return

		pendingRefreshSrcRef.current = ''
		// refreshIframe(targetSrc)
	}, [debugSrc, refreshIframe])

	useEffect(() => {
		const currentSrcSet = new Set(iframes.map((item) => item.src))
		const removedIframes = prevIframesRef.current.filter((item) => !currentSrcSet.has(item.src))

		removedIframes.forEach((item) => {
			props.onIframeDestory?.(item.src)
			delete iframeRefs.current[item.src]
			loadedSrcsRef.current.delete(item.src)
		})

		prevIframesRef.current = iframes
		emitLoadedIfReady(iframes)
	}, [iframes])

	useEffect(() => {
		if (debugSrc) {
			context.component?.actions.loaded()
		}
	}, [debugSrc])

	return ready ? (
		<div style={{ display: 'contents' }}>
			{iframes.map((item, index) => {
				const src = buildIframeSrc(item.src, runtimeUrl)

				return (
					<div
						key={item.src}
						style={{
							width: '1440px',
							height: '100vh',
							visibility: debugSrc ? (item.src === debugSrc ? 'visible' : 'hidden') : 'visible',
							marginLeft: (debugSrc && index) ? 280 : 'unset'
						}}
						data-zone-type="page"
						data-zone-kind="iframe"
						data-zone-title={item.src}
						data-zone-filename={item.src}
						>
						<iframe
							id={item.src}
							src={src}
							ref={(node) => {
								iframeRefs.current[item.src] = node
							}}
							style={{
								border: 'none',
								width: '100%',
								height: '100%'
							}}
							onLoad={(event) => {
								loadedSrcsRef.current.add(item.src)
								props.onIframeLoad({
									id: item.src,
									doc: event.currentTarget.contentDocument,
									routerPath: item.src
								})
								emitLoadedIfReady(currentIframesRef.current)
							}}
						/>
					</div>
				)
			})}
		</div>
	) : (
		<div data-zone-type="ai-request" style={{ width: 1200, height: 800 }}>
			<ProjectRuntimeTerminal componentId={props.id} />
		</div>
	)
}

export default RuntimeIframe
