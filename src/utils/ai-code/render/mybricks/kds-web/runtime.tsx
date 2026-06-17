import React from 'react'
import context from '../../../../../mix/context'
import type { CreateMyBricksProps } from '../type'
import RuntimeContainer from '../components/runtimeContainer'

const runtime = (props: CreateMyBricksProps) => {
  const debugTarget: any = props.env._debugTarget

  const Page = ({ page, style }) => {
    const Render = page.module.default

    return (
      <div
        data-zone-type='page'
        data-zone-kind='page'
        data-desn-page={page.file.filename}
        data-zone-title='页面'
        data-widge-name='页面'
        style={{
          width: 414,
          display: 'flex',
          flexDirection: 'column',
          ...style
        }}
      >
        <Render />
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
      return <Component {...props} />
    }
  }

  const popupRef = () => {
    return () => {
      return
    }
  }

  return {
    appRef,
    comRef,
    popupRef
  }
}

export default runtime
