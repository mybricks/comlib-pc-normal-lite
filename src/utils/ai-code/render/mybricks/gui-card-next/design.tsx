import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import context from '../../../../../mix/context'
import {
  IS_TOOL,
  IS_CARD_CONFIG,
  MOBILE_CARD_STYLE,
  PC_CARD_STYLE,
  MOBILE_CONTAINER_STYLE,
  PC_CONTAINER_STYLE,
} from './constants'
import AIChatPanel from './ChatPanel'
import { randomUUID } from '../../../../../mix/utils/uuid'
import type { CreateMyBricksProps } from '../type'

const design = (props: CreateMyBricksProps) => {
  const { data } = props

  const getShowTypeAndCardStyle = (filename: string) => {
    const showType = data.gui_card.showTypeMap?.[filename] || 'mobile'
    return {
      showType,
      cardStyle: showType === 'mobile' ? MOBILE_CARD_STYLE : PC_CARD_STYLE
    }
  }

  const getShowTypeAndAgentStyle = (filename: string) => {
    const showType = data.gui_card.showTypeMap?.[filename] || 'mobile'
    return {
      showType,
      cardStyle: showType === 'mobile' ? MOBILE_CONTAINER_STYLE : PC_CONTAINER_STYLE
    }
  }

  // 弹窗注册表，存储通过 popupRef 包装的组件实例
  const popupsCollection: Array<{ id: string; Component: React.ComponentType<any>; props: any; params: { widgetName: string; filename: string }} > = []
  let forceUpdateApp: (() => void) | null = null

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
        style={style}
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

  const Popup = ({ props, Component, params }) => {
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
          data-zone-kind="agent-popup"
          data-desn-page=''
          data-zone-title='弹窗'
          data-widge-name='弹窗'
          style={MOBILE_CONTAINER_STYLE}
        >
          {container && <Component {...props} popupNode={container}/>}
        </div>
      )
    }

  const appRef = () => {
    return () => {
      const [skills, setSkills] = useState<any[]>([])
      const [showSkills, setShowSkills] = useState<any[]>([])
      const [tick, setTick] = useState(0)

      useEffect(() => {
        forceUpdateApp = () => setTick(t => t + 1)
        return () => {
          forceUpdateApp = null
        }
      }, [])

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
              pages: skill.cards.map((config) => {
                return {
                  ...config,
                  parameters: config.props,
                }
              }),
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
            if (skill) {
              showSkills.push(skill)
            }
          })
        }
        setShowSkills(showSkills)
      }, [skills, data._showPages])

      // useEffect(() => {
      //   context.component!.actions.loaded()
      // }, [showSkills, tick])

      context.component!.actions.loaded()

      const { showType, cardStyle } = getShowTypeAndAgentStyle('GUI_AGENT')

      return (
        <>
          <Card
            config={{
              title: '智能体'
            }}
            filename='GUI_AGENT'
            data-widget-name='GUI_AGENT'
            data-zone-kind="agent-app"
            data-zone-show-type={showType}
            style={cardStyle}
          >
            <AIChatPanel
              disabled={true}
              cards={[]}
              tools={[]}
              config={data.gui_card}
            />
          </Card>
          {showSkills.map(({ id, name, title, cards, tools }) => {
            const prefix = id.replace(/SKILL\.md$/, '')
            const popups = popupsCollection.filter(popup => popup.params.filename.startsWith(prefix))
            return (
              <div
                data-zone-type='skill'
                data-zone-title={title}
                data-zone-filename={id}
                data-zone-chip={JSON.stringify({
                  type: 'SKILL',
                  label: `SKILL(${name})`,
                  info: `- SKILL(${name})\n` + 
                  ` - 相关代码：位于${id}`
                })}
                data-skill-id={id}
              >
                {tools?.length ? (
                  <div
                    data-zone-type='agent-tools'
                    data-zone-ignore='1'
                  >
                    {tools.map(({ name, title }) => {
                      return (
                        <div
                          data-zone-type='agent-tool'
                          data-tool-name={name}
                        >
                          {title}
                        </div>
                      )
                    })}
                  </div>
                ): null}
                {cards.map(({ render: Render, filename, config }) => {
                  const { showType, cardStyle } = getShowTypeAndCardStyle(filename)
                  return (
                    <Card
                      key={filename}
                      config={config}
                      filename={filename}
                      data-zone-filename={filename}
                      data-zone-chip={JSON.stringify({
                        type: 'SKILL_CARD',
                        label: `SKILL_CARD(${name}_${config.name})`,
                        info: `SKILL_CARD(${name}_${config.name})\n` + 
                          ` - 相关代码：位于${filename}`
                      })}
                      data-zone-name={config.name}
                      data-zone-show-type={showType}
                      style={cardStyle}
                    >
                      <Render />
                    </Card>
                  )
                })}
                {popups.map(({ id, Component, props, params }) => {
                  return <Popup key={id} Component={Component} props={props} params={params}/>
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

  const popupRef = (Component, params) => {
      const popupId = `popup_${randomUUID()}`
  
      return (currentProps) => {
        const isFirstRender = useRef(true)
  
        // 挂载时注册到收集器，卸载时移除
        useEffect(() => {
          if (!popupsCollection.find((p) => p.params.filename === params.filename)) {
            popupsCollection.push({ id: popupId, Component, props: currentProps, params })
            forceUpdateApp?.()
          }
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
