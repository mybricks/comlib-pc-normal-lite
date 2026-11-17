import commonLang from '../../../../../helpers/i18n/common'
import React, { useEffect, useLayoutEffect, useState } from 'react'
import context from '../../../../../mix/context'
import type { CreateMyBricksProps } from '../type'
import { CanvasZone, ExtensionEditor, useCanvasContainer } from './shared'

const getCanvasPath = (params: { filename?: string, widgetName?: string, type: 'popup' | 'page'}) => {
  const { filename, widgetName, type } = params
  return `${type}:${filename || 'unknown'}:${widgetName || 'default'}`
}

const design = (props: CreateMyBricksProps) => {

  const Popup = ({ id, props, Component, params }) => {
    const { containerRef, container } = useCanvasContainer()

    useLayoutEffect(() => {
      const { filename, widgetName } = params
      const fileSystem = context.fileSystem
      const jsDocMap = fileSystem?.filesMap?.[filename]?.file?.jsDocMap
      if (jsDocMap) {
        const jsDoc = JSON.parse(decodeURIComponent(jsDocMap))
        const title = jsDoc?.[widgetName]?.title
        if (title) {
          containerRef.current!.setAttribute("data-zone-title", title);
        }
      }
    }, [])

    return (
      <CanvasZone
        ref={containerRef}
        kind='popup'
        id={id}
        title={commonLang.popup}
        style={{
          width: 900,
          height: 900,
          position: 'relative',
          transform: 'scale(1)'
        }}
      >
        {container && <Component {...props} popupNode={container}/>}
      </CanvasZone>
    )
  }
  
  const popupsCollection: Array<{ id: string; Component: React.ComponentType<any>; props: any; params: { widgetName: string; filename: string }} > = []
  let forceUpdateApp: () => void = () => {}

  const appRef = (fn) => {
    const extension = fn()
    
    return () => {
      const editors = extension?.contributes?.editors
      const [, setTick] = useState(0)

      useLayoutEffect(() => {
        forceUpdateApp = () => setTick(t => t + 1)
        return () => {
          forceUpdateApp = () => {}
        }
      }, [])

      context.component!.actions.loaded()

      if (Array.isArray(editors) && editors.length) {
        return (
          <>
            {editors.map(({ id, title, render }) => {
              return (
                <CanvasZone
                  key={id}
                  id={id}
                  title={title}
                  filename={id}
                  style={{
                    width: 239,
                    height: 'fit-content'
                  }}
                >
                  <ExtensionEditor render={render} />
                </CanvasZone>
              )
            })}
            {popupsCollection.map(({ id, Component, props, params }) => {
              return (
                <Popup key={id} id={id} Component={Component} props={props} params={params}/>
              )
            })}
          </>
        )
      }

      return <div>暂无扩展内容</div>
    }
  }

  const comRef = (Component) => {
    return Component
  }

  const popupRef = (Component, params) => {
    const canvasPath = getCanvasPath({ ...params, type: 'popup' })

    return (props) => {
      useEffect(() => {
        if (!popupsCollection.find((p) => p.id === canvasPath)) {
          popupsCollection.push({ id: canvasPath, Component, props, params })
          forceUpdateApp()
        }
        return () => {
          const idx = popupsCollection.findIndex(p => p.id === canvasPath)
          if (idx !== -1) {
            popupsCollection.splice(idx, 1)
            forceUpdateApp()
          }
        }
      }, [])
      return null
    }
  }

  return {
    appRef,
    comRef,
    popupRef
  }
}

export default design
