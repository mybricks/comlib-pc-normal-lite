import React, { useState, useEffect, useRef } from 'react'
import { registerSandbox } from './sandbox/forLocalIframe'
import context from './context'

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
	const [debugReloadKey, setDebugReloadKey] = useState(0)
	const debugSrcRef = useRef('')

	useEffect(() => {
		registerSandbox(props.id)

		const routesEvents = (window as any).__APP__!.routesEvents
		const cancelRoutesEventsRoutes = routesEvents.on('routes', (routes: RuntimeRouteEventItem[]) => {
			console.log('routes', routes)

			const nextRoutes = routes.map((route) => {
				return {
					...route,
					src: buildItemPath(route.path, route.params)
				}
			})

			setIframes(nextRoutes)

			context.component?.actions.loaded({
				pageList: nextRoutes.map((route) => {
					return {
						...route,
						id: route.src
					}
				})
			})
		})

		const events = context.component!.events;
		const onEventsDebugTargetCancel = events.on('debugTarget', (props) => {
			if (props.src && props.src !== debugSrcRef.current) {
				setDebugReloadKey((key) => key + 1)
			}
			debugSrcRef.current = props.src || ''
			setDebugSrc(props.src)
		})

		return () => {
			cancelRoutesEventsRoutes()
			onEventsDebugTargetCancel()
		}
	}, [])

	return (
		<>
			{iframes.map((item) => {
				const src = `${window.location.origin}${routerBasename}${item.src === '/' ? '' : item.src}`

				return (
					<div
						key={item.src === debugSrc ? `${item.src}-${debugReloadKey}` : item.src}
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
