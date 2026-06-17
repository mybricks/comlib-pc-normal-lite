import React, { useEffect, useState } from 'react'
import context from '../../../../../mix/context'
import { PAGE_ENTRY_PATTERN } from './constants'
import type { CreateMyBricksProps } from '../type'


const design = (props: CreateMyBricksProps) => {
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
          width: 1200,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <Render />
      </div>
    )
  }

  const appRef = () => {
    return () => {
      const [pages, setPages] = useState<any>([]);

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
      }, [pages])

      return pages.map((page) => {
        return (
          <Page
            key={page.file.filename}
            page={page}
          />
        )
      })
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

export default design
