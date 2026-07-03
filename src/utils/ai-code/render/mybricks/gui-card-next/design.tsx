import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import context from '../../../../../mix/context'
import { IS_TOOL, IS_CARD_CONFIG } from './constants'
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
        data-zone-kind="agent-card"
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
      const [skills, setSkills] = useState<any[]>([])
      const [showSkills, setShowSkills] = useState<any[]>([])

      useEffect(() => {
        const collectCards = () => {
          const skills: any = []

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
                  tools: [],
                  name: frontmatter.name,
                  title: frontmatter.title,
                  description: frontmatter.description,
                }

                skills.push(skill)

                const dir = filename.split('/').slice(0, -1).join('/') + '/'

                Object.entries(context.fileSystem!.filesMap).forEach(([filename, file]) => {
                  if (filename.startsWith(dir)) {
                    if (filename.endsWith('index.config.ts')) {
                      const module = file.module.default
                      if (module?.[IS_CARD_CONFIG]) {
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
                    } else if (filename.endsWith('index.ts')) {
                      const module = file.module.default
                      if (module?.[IS_TOOL] && typeof module.createTool === 'function') {
                        try {
                          skill.tools.push(module.createTool())
                        } catch {}
                      }
                    }
                  }
                })
              }
            }
          })

          context.component?.actions?.updatePages?.(skills.map((skill) => {
            return {
              id: skill.id,
              title: skill.title,
              type: skill.type,
              pages: skill.cards,
              description: skill.md,
              tools: skill.tools
            }
          }))

          setSkills(skills)
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
        const showSkills: any = []
        if (data._showPages?.length) {
          data._showPages.forEach((filename) => {
            const skill = skills.find((skill) => skill.id === filename)
            if (skill?.cards?.length) {
              showSkills.push(skill)
            }
          })
        }
        setShowSkills(showSkills)
      }, [skills, data._showPages])

      useEffect(() => {
        context.component!.actions.loaded()
      }, [showSkills])

      return (
        <>
          <Card
            config={{
              title: 'Agent'
            }}
            filename='GUI_AGENT'
            data-widget-name='GUI_AGENT'
            data-zone-kind="agent-app"
            style={{
              width: 414,
              height: 896,
            }}
          >
            <AIChatPanel
              disabled={true}
              cards={[]}
              tools={[]}
              config={data.gui_card}
            />
          </Card>
          {showSkills.map(({ id, name, title, cards }) => {
            return (
              <div
                data-zone-type='skill'
                data-zone-title={title}
                data-zone-chip={JSON.stringify({
                  type: 'SKILL',
                  label: `SKILL(${name})`,
                  info: `- SKILL(${name})\n` + 
                  ` - 相关代码：位于${id}`
                })}
                data-skill-id={id}
              >
                {cards.map(({ render: Render, filename, config }) => {
                  return (
                    <Card key={filename} config={config} filename={filename}>
                      <Render />
                    </Card>
                  )
                })}
              </div>
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

export default design
