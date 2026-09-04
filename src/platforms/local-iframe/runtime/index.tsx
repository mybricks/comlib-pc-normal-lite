import React, { useState, useEffect, useRef, useCallback } from 'react'
import { registerSandbox } from '../../../mix/sandbox/forLocalIframe'
import context from '../../../mix/context'

type RouteParamDraft = {
  key: string
  value: string
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

const routerBasename = normalizeBasePath(window.__LINGCHUANG_CONFIG__?.router?.basename || '')

const buildIframeSrc = (itemSrc: string) => {
	return `${window.location.origin}${routerBasename}${itemSrc === '/' ? '' : itemSrc}`
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
	const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({})
	const pendingRefreshSrcRef = useRef('')
	const debugSrcRef = useRef('')

	const refreshIframe = useCallback((itemSrc: string) => {
		const iframe = iframeRefs.current[itemSrc]
		if (!iframe) return false

		const expectedSrc = buildIframeSrc(itemSrc)

		try {
			const currentSrc = iframe.contentWindow?.location?.href || iframe.src
			if (currentSrc && currentSrc !== expectedSrc) {
				iframe.src = expectedSrc
				return true
			}

			// iframe.contentWindow?.location.reload()
			return true
		} catch {
			iframe.src = expectedSrc
			return true
		}
	}, [])

	useEffect(() => {
		registerSandbox(props.id)

		const routesEvents = (window as any).__APP__!.routesEvents
		const cancelRoutesEventsRoutes = routesEvents.on('routes', (routes: RuntimeRouteEventItem[]) => {
			const nextRoutes = routes.map((route) => {
				return {
					...route,
					src: buildItemPath(route.path, route.params)
				}
			})

			setIframes(nextRoutes)
		})

		const events = context.component!.events;
		const onEventsDebugTargetCancel = events.on('debugTarget', (props) => {
			const nextSrc = props.src || ''
			const previousSrc = debugSrcRef.current
			pendingRefreshSrcRef.current = nextSrc || previousSrc
			debugSrcRef.current = nextSrc
			setDebugSrc(nextSrc)
		})

		return () => {
			cancelRoutesEventsRoutes()
			onEventsDebugTargetCancel()
		}
	}, [])

	useEffect(() => {
		const targetSrc = pendingRefreshSrcRef.current
		if (!targetSrc) return

		pendingRefreshSrcRef.current = ''
		refreshIframe(targetSrc)
	}, [debugSrc, refreshIframe])

	useEffect(() => {
		context.component?.actions.loaded({
			pageList: iframes.map((route) => {
				return {
					...route,
					id: route.src
				}
			})
		})
	}, [iframes])

	return (
		<>
			{iframes.map((item) => {
				const src = buildIframeSrc(item.src)

				return (
					<div
						key={item.src}
						style={{
							width: '1440px',
							height: '100vh',
							visibility: debugSrc ? (item.src === debugSrc ? 'visible' : 'hidden') : 'visible'
						}}
						data-zone-type="page"
						data-zone-kind="iframe"
						data-zone-title={item.src}
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
								props.onIframeLoad({
									id: item.src,
									doc: event.currentTarget.contentDocument
								})
							}}
						/>
					</div>
				)
			})}
		</>
	)
}

export default RuntimeIframe
