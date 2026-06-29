import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import context from '../../../../../mix/context'
import { IS_TOOL, IS_CARD_CONFIG } from './constants'
import AIChatPanel from '../../ChatPanel'
import RuntimeContainer from '../components/runtimeContainer'
import type { CreateMyBricksProps } from '../type'

const runtime = (props: CreateMyBricksProps) => {
  const { data, env } = props
  const debugTarget: any = env._debugTarget

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
      const filename = debugTarget.pageIndex

      const [skills, setSkills] = useState<any[] | null>(null)
      const [tools, setTools] = useState<any[]>([])

      useEffect(() => {
        const skills: any = []
        const tools: any = []
        
        Object.entries(context.fileSystem!.filesMap).forEach(([filename, file]) => {
          if (filename.endsWith('/SKILL.md')) {
            const md: string = file.module.default.trim()

            // 解析 frontmatter（--- ... --- 之间的内容）
            const frontmatter: Record<string, string> = {}
            const match = md.match(/^---\s*\n([\s\S]*?)\n---/)
            if (match) {
              match[1].split('\n').forEach((line) => {
                const colonIdx = line.indexOf(':')
                if (colonIdx !== -1) {
                  const key = line.slice(0, colonIdx).trim()
                  const value = line.slice(colonIdx + 1).trim()
                  frontmatter[key] = value
                }
              })

              const skill: any = {
                md,
                id: filename,
                type: '',
                cards: [],
                name: frontmatter.name,
                title: frontmatter.title,
                description: frontmatter.description,
              }

              skills.push(skill)

              const dir = filename.split('/').slice(0, -1).join('/')

              Object.entries(context.fileSystem!.filesMap).forEach(([filename, file]) => {
                if (filename.endsWith('index.config.ts') && filename.startsWith(dir)) {
                  const module = file.module.default
                  if (module?.[IS_CARD_CONFIG] === IS_CARD_CONFIG) {
                    // 找到对应的 index.tsx
                    const cardFileName = filename.split('/').slice(0, -1).concat('index.tsx').join('/')
                    const runtime = context.fileSystem!.filesMap[cardFileName]
                    if (runtime) {
                      skill.cards.push({
                        filename: cardFileName,
                        config: module,
                        render: runtime.module.default
                      })
                    }
                  }
                }
              })
            }
          } else {
            const module = file.module.default
            if (module?.[IS_TOOL] === IS_TOOL && typeof module.createTool === 'function') {
              tools.push(module.createTool)
            }
          }
        })

        setSkills(skills)
        setTools(tools)
      }, [])

      if (!skills) {
        return
      }

      if (filename === 'GUI_AGENT') {
        return (
          <RuntimeContainer style={{...debugTarget.rootStyle}}>
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
                cards={skills.map((skill) => {
                  return {
                    ...skill,
                    cards: skill.cards.map(({ config, render }) => {
                      return {
                        ...config,
                        render
                      }
                    })
                  }
                })}
                tools={tools.map((createTool) => {
                  return createTool()
                })}
                config={data.gui_card}
              />
            </Card>
          </RuntimeContainer>
        )
      }

      const allCards = skills.flatMap((g) => g.cards);
      const { config, render: Render } = allCards.find((card) => card.filename === filename)

      return (
        <RuntimeContainer style={{...debugTarget.rootStyle}}>
          <Card
            config={config}
            filename={filename}
            style={debugTarget?.style}
          >
            <Render />
          </Card>
        </RuntimeContainer>
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

  const defineTool = (fn) => {
    return {
      createTool: fn,
      [IS_TOOL]: IS_TOOL
    }
  }

  return {
    appRef,
    comRef,
    popupRef,
    defineTool,
    defineConfig,
  }
}

export default runtime
