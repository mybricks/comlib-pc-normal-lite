import React, { createContext, useContext } from 'react'
import type { CreateMyBricksProps } from '../type'
import context from '../../../../../mix/context'
import { CanvasZone, ExtensionEditor, useCanvasContainer } from './shared'

const runtime = (props: CreateMyBricksProps) => {
  const { env } = props
  const debugTarget: any = env._debugTarget

  const PageContext = createContext({
    container: document.body,
  });

  const Page = ({ style, children }) => {
    const { containerRef, container } = useCanvasContainer()

    context.component!.actions.loaded()

    return (
      <CanvasZone
        ref={containerRef}
        id={debugTarget.pageIndex}
        filename={debugTarget.pageIndex}
        style={{
          ...style
        }}
      >
        {container && (
          <PageContext.Provider value={{ container }}>
            {children}
          </PageContext.Provider>
        )}
      </CanvasZone>
    )
  }

  const appRef = (fn) => {
    const extension = fn()
    const editor = extension.contributes.editors.find((editor) => editor.id === debugTarget.pageIndex)
    const Render = editor.render
    return () => {
      return (
        <div
          style={{
            ...debugTarget.rootStyle
          }}
        >
          <Page
            style={{
              ...debugTarget.style
            }}
          >
            <ExtensionEditor render={Render} />
          </Page>
        </div>
      )
    }
  }

  const comRef = (Component) => {
    return (props) => {
      const pageContext = useContext(PageContext)
      return <Component {...props} popupNode={pageContext.container}/>
    }
  }

  return {
    appRef,
    comRef,
    popupRef: comRef
  }
}

export default runtime
