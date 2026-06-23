import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import context from '../../../../../mix/context'
import { IS_CARD_CONFIG } from './constants'
import AIChatPanel from '../../ChatPanel'
import type { CreateMyBricksProps } from '../type'

const design = (props: CreateMyBricksProps) => {
  const { data } = props

  const Card = ({
    config,
    filename,
    children,
    style = {},
    ...rest
  }: any) => {
    const ref = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
      const firstWidget = ref.current!.querySelector('[data-widget-name]')!
      if (firstWidget) {
        const widgetName = firstWidget.getAttribute('data-widget-name')!
        ref.current?.setAttribute('data-widget-name', widgetName)
      }
    }, [children])

    return (
      <div
        ref={ref}
        style={{
          width: 414,
          height: 'fit-content',
          ...style,
        }}
        data-zone-type="page"
        data-zone-kind="page"
        data-zone-title={config.title}
        data-desn-page={filename}
        {...rest}
      >
        {children}
      </div>
    )
  }

  const appRef = () => {
    return () => {
      const [cards, setCards] = useState<any[]>([])

      useEffect(() => {
        const collectCards = () => {
          const cards: any = []
          Object.entries(context.fileSystem!.filesMap).forEach(([filename, file]) => {
            if (filename.endsWith('index.config.ts')) {
              const module = file.module.default
              if (module?.[IS_CARD_CONFIG]) {
                // 说明是卡片配置，找到对应的index.tsx
                const cardFileName = filename.split('/').slice(0, -1).concat('index.tsx').join('/')
                const runtime = context.fileSystem!.filesMap[cardFileName]
                if (runtime) {
                  cards.push({
                    filename: cardFileName,
                    config: module,
                    render: runtime.module.default
                  })
                }
              }
            }
          })

          setCards(cards)
        }

        collectCards()

        const cancel = context.fileSystem!.events.on('fileChange', ({ filename, type }) => {
          collectCards()
        })

        return () => {
          cancel()
        }
      }, [])

      useEffect(() => {
        context.notifyChanged('gui_agent', 'update', {
          docs: [
            {
              name: 'GUI_AGENT',
              refSelector: '[data-widget-name="GUI_AGENT"]',
              summary: 'GUI_AGENT',
              title: 'GUI_AGENT',
              type: 'com'
            }
          ],
          events: [],
          services: [],
          state: [],
          store: [],
        })
        context.component!.actions.loaded()
      }, [cards])

      return (
        <>
          <Card
            config={{
              title: 'Agent'
            }}
            filename='GUI_AGENT'
            data-widget-name='GUI_AGENT'
            style={{
              width: 800,
              height: 900,
            }}
          >
            <AIChatPanel
              disabled={true}
              getCardsGroups={() => []}
              config={data.gui_card}
            />
          </Card>
          {cards.map(({ render: Render, filename, config }) => {
            return (
              <Card key={filename} config={config} filename={filename}>
                <Render />
              </Card>
            )
          })}
        </>
      )
    }
  }

  const comRef = (Component) => {
    return Component
  }

  const popupRef = () => {
    console.log('[TODO:popupRef]')
    return () => {
      return null
    }
  }

  const defineConfig = (config) => {
    return {
      ...config,
      [IS_CARD_CONFIG]: IS_CARD_CONFIG
    }
  }

  return {
    appRef,
    comRef,
    popupRef,
    defineConfig
  }
}

export default design
