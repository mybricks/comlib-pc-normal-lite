import React, {
  useRef,
  useState,
  useContext,
  createContext,
  useLayoutEffect
} from 'react'
import context from '../../../../../mix/context'
import type { CreateMyBricksProps } from '../type'
import RuntimeContainer from '../components/runtimeContainer'
import { DEFAULT_STYLE } from './constants'

const runtime = (props: CreateMyBricksProps) => {
  const debugTarget: any = props.env._debugTarget

  const PageContext = createContext({
    container: document.body,
  });

  const Page = ({ page, style }) => {
    const Render = page.module.default
    const containerRef = useRef(null)
    const [container, setContainer] = useState<HTMLDivElement>()

    useLayoutEffect(() => {
      setContainer(containerRef.current!)
    }, [])

    return (
      <div
        ref={containerRef}
        data-zone-type='page'
        data-zone-kind='page'
        data-desn-page={page.file.filename}
        data-zone-title='页面'
        data-widge-name='页面'
        style={{
          ...DEFAULT_STYLE,
          ...style
        }}
      >
        {container && (
          <PageContext.Provider value={{ container }}>
            <Render />
          </PageContext.Provider>
        )}
      </div>
    )
  }

  const appRef = () => {
    return () => {
      const filename = debugTarget.pageIndex
      return (
        <RuntimeContainer style={{...debugTarget.rootStyle}}>
          <Page page={context.fileSystem!.filesMap[filename]} style={debugTarget.style}/>
        </RuntimeContainer>
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
