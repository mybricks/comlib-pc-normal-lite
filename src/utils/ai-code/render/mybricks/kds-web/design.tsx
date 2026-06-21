import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import context from '../../../../../mix/context'
import { PAGE_ENTRY_PATTERN } from './constants'
import { randomUUID } from '../../../../../mix/utils/uuid'
import type { CreateMyBricksProps } from '../type'


const design = (props: CreateMyBricksProps) => {
  // 弹窗注册表，存储通过 popupRef 包装的组件实例
  const popupsCollection: Array<{ id: string; Component: React.ComponentType<any>; props: any }> = []
  let forceUpdateApp: (() => void) | null = null

  const Page = ({ page }) => {
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
          transform: 'scale(1)',
          height: 896,
        }}
      >
        <Render />
      </div>
    )
  }

  const Popup = ({ props, Component }) => {
    const containerRef = useRef(null)
    const [container, setContainer] = useState<HTMLDivElement>()

    useLayoutEffect(() => {
      setContainer(containerRef.current!)
    }, [])

    return (
      <div
        ref={containerRef}
        data-zone-type='page'
        data-zone-kind='popup'
        data-desn-page=''
        data-zone-title='弹窗'
        data-widge-name='弹窗'
        style={{
          width: 414,
          display: 'flex',
          flexDirection: 'column',
          transform: 'scale(1)',
          height: 896,
        }}
      >
        {container && <Component {...props} popupNode={container}/>}
      </div>
    )
  }

  const appRef = () => {
    return () => {
      const [pages, setPages] = useState<any>([]);
      const [tick, setTick] = useState(0)

      useEffect(() => {
        forceUpdateApp = () => setTick(t => t + 1)
        return () => {
          forceUpdateApp = null
        }
      }, [])

      useEffect(() => {
        const collectPages = () => {
          const pages: any = []
          Object.entries(context.fileSystem!.filesMap).forEach(([filename, file]) => {
            if (PAGE_ENTRY_PATTERN.test(filename)) {
              pages.push(file)
            }
          })
          setPages(pages)
        }

        collectPages()

        const cancel = context.fileSystem!.events.on('fileChange', ({ filename, type }) => {
          if (PAGE_ENTRY_PATTERN.test(filename) && (type === 'create' || type === 'delete')) {
            collectPages()
          }
        })

        return () => {
          cancel()
        }
      }, [])

      useEffect(() => {
        context.component!.actions.loaded()
      }, [pages, tick])

      return (
        <>
          {pages.map((page) => (
            <Page
              key={page.file.filename}
              page={page}
            />
          ))}
          {popupsCollection.map(({ id, Component, props }) => {
            return <Popup key={id} Component={Component} props={props}/>
          })}
        </>
      )
    }
  }

  const comRef = (Component) => {
    return (props) => {
      return <Component {...props} />
    }
  }

  const popupRef = (Component) => {
    const popupId = `popup_${randomUUID()}`

    return (currentProps) => {
      const isFirstRender = useRef(true)

      // 挂载时注册到收集器，卸载时移除
      useEffect(() => {
        popupsCollection.push({ id: popupId, Component, props: currentProps })
        forceUpdateApp?.()
        return () => {
          const idx = popupsCollection.findIndex(p => p.id === popupId)
          if (idx !== -1) {
            popupsCollection.splice(idx, 1)
            forceUpdateApp?.()
          }
        }
      }, [])

      // props 变化时同步到注册表，跳过首次渲染（注册时已初始化）
      useEffect(() => {
        if (isFirstRender.current) {
          isFirstRender.current = false
          return
        }
        const entry = popupsCollection.find(p => p.id === popupId)
        if (entry) {
          entry.props = currentProps
          forceUpdateApp?.()
        }
      })

      // 不在原位置渲染，实际渲染由 appRef 统一负责
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
