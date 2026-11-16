import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import context from '../../../../../mix/context'
import type { CreateMyBricksProps } from '../type'

const getCanvasPath = (params: { filename?: string, widgetName?: string, type: 'popup' | 'page'}) => {
  const { filename, widgetName, type } = params
  return `${type}:${filename || 'unknown'}:${widgetName || 'default'}`
}

const design = (props: CreateMyBricksProps) => {

  const Popup = ({ id, props, Component, params }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [container, setContainer] = useState<HTMLDivElement>()

    useLayoutEffect(() => {
      setContainer(containerRef.current!)
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
      <div
        ref={containerRef}
        data-zone-type='page'
        data-zone-kind='popup'
        data-desn-page={id}
        data-zone-title='弹窗'
        style={{
          width: 900,
          height: 900,
          position: 'relative',
          transform: 'scale(1)'
        }}
      >
        {container && <Component {...props} popupNode={container}/>}
      </div>
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
            {editors.map(({ id, title, description, render }) => {
              const Render = render
              return (
                <div
                  data-zone-type='page'
                  data-zone-kind='page'
                  data-desn-page={id}
                  data-zone-title={title}
                  data-zone-filename={id}
                  style={{
                    width: 239,
                    height: 'fit-content'
                  }}
                >
                  <Render 
                    context={{
                      prd: {
                        async get() {
                          return null
                        }
                      }
                    }}
                  />
                </div>
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
