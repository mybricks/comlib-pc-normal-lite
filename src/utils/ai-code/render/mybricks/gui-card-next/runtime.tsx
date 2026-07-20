import React, { useEffect, useLayoutEffect, useRef, useState, createContext, useContext } from 'react'
import context from '../../../../../mix/context'
import { IS_TOOL, IS_CARD_CONFIG, CONTAINER_STYLE } from './constants'
import AIChatPanel from './ChatPanel'
import RuntimeContainer from '../components/runtimeContainer'
import { DefaultToolCallHistory } from './default-tool-call-history'
import { randomUUID } from '../../../../../mix/utils/uuid'
import type { CreateMyBricksProps } from '../type'

const runtime = (props: CreateMyBricksProps) => {
  const { data, env } = props
  const debugTarget: any = env._debugTarget
  const PageContext = createContext<{
    container: HTMLDivElement | null
  }>({
    container: null,
  });

  const Card = ({
    config,
    filename,
    children,
    style = {},
    ...rest
  }: any) => {
    const ref = useRef<HTMLDivElement>(null)
     const [container, setContainer] = useState<HTMLDivElement>()

    useLayoutEffect(() => {
      const firstWidget = ref.current!.querySelector('[data-widget-name]')!
      if (firstWidget) {
        const widgetName = firstWidget.getAttribute('data-widget-name')!
        ref.current!.setAttribute('data-widget-name', widgetName)
      }
      setContainer(ref.current!)
    }, [children])

    return (
      <div
        ref={ref}
        style={style}
        data-zone-type="page"
        data-zone-kind="page"
        data-zone-title={config.title}
        data-desn-page={filename}
        {...rest}
      >
        {container && (
          <PageContext.Provider value={{ container }}>
            {children}
          </PageContext.Provider>
        )}
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

      let initialHistory;

      const allCards = skills.flatMap((g) => g.cards);
      const card = allCards.find((card) => card.filename === filename)

      if (card) {
        // 构建 apis 说明文字：将卡片声明的 apis 列表格式化给 LLM
        const apisDesc = card?.config?.apis?.length > 0
          ? card.config.apis.map((api) => `  - ${api.name}: ${api.description}`).join('\n')
          : '  （该卡片未声明任何 API）'
        const canvasId = randomUUID()
        const params = {
          components: [
            {
              id: 'root',
              component: card?.config?.name,
              props: {},
            },
          ],
        }
        initialHistory = new DefaultToolCallHistory({
          toolName: 'render_canvas',
          toolTitle: '渲染画布',
          toolArgs: params,
          toolResult: {
            output: `画布已渲染。
canvasId: ${canvasId}
可通过 call_canvas_component_api 调用以下组件 API：
  - componentId: root, component: ${card?.config?.name}
${apisDesc}
注意：componentId 对应 render_canvas 入参 components 中的 id；调用 API 前请使用上述 canvasId。`,
          metadata: {
            canvasId,
            params,
            success: true,
          },
          },
          userText: card?.config?.title,
        })
      }

      return (
        <RuntimeContainer style={{...debugTarget.rootStyle}}>
          <Card
            config={{
              title: 'Agent'
            }}
            filename='GUI_AGENT'
            data-widget-name='GUI_AGENT'
            style={{
              ...CONTAINER_STYLE,
              ...debugTarget?.style,
              width: CONTAINER_STYLE.width,
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
              history={initialHistory}
            />
          </Card>
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
