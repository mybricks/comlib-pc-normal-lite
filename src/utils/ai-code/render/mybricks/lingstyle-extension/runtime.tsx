import React, { useLayoutEffect, useRef, useState, createContext, useContext } from 'react'
import type { CreateMyBricksProps } from '../type'
import context from '../../../../../mix/context'

const runtime = (props: CreateMyBricksProps) => {
  const { env } = props
  const debugTarget: any = env._debugTarget

  const PageContext = createContext({
    container: document.body,
  });

  const Page = ({ style, children }) => {
    const containerRef = useRef(null)
    const [container, setContainer] = useState<HTMLDivElement>()

    useLayoutEffect(() => {
      setContainer(containerRef.current!)
    }, [])

    context.component!.actions.loaded()

    return (
      <div
        ref={containerRef}
        data-zone-type='page'
        data-zone-kind='page'
        data-desn-page={debugTarget.pageIndex}
        data-zone-filename={debugTarget.pageIndex}
        style={{
          ...style
        }}
      >
        {container && (
          <PageContext.Provider value={{ container }}>
            {children}
          </PageContext.Provider>
        )}
      </div>
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
            <Render
              context={{
                prd: {
                  async get() {
                    return null
                  }
                }
              }}
            />
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

  const popupRef = (Component) => {
    return (props) => {
      const pageContext = useContext(PageContext)
      return <Component {...props} popupNode={pageContext.container}/>
    }
  }

  return {
    appRef,
    comRef,
    popupRef
  }
}

export default runtime
