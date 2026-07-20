import React from 'react'
import { randomUUID } from '../../../../../../../../mix/utils/uuid'
import CanvasRender, { BuildInContainer } from './CanvasRender'
import type { ToolParams } from './type'

const RENDER_CANVAS_TOOL_NAME = 'render_canvas'

const createRenderCanvasTool = (props) => {
  const { components } = props
  components['build_in_container'] = {
    render: BuildInContainer
  }
  const componetNames: string[] = Object.keys(components)
  const compnentNamesSet = new Set(componetNames)
  return {
    name: RENDER_CANVAS_TOOL_NAME,
    title: "渲染画布",
    description: `按需选择组件，动态组合，渲染画布。
通过 components 描述组件树，但 components 必须是一个扁平数组，根 id 为 root。

<component source>
build_in_components 中声明的 组件。
business_context 中各类能力提供的 可用卡片。
IMPORTANT：name 对应 comonent 字段；config 对应 props 字段。
</component source>

<build_in_components>
- name: build_in_container  title: 布局容器  desc: 一个用于排列子元素的布局组件
  - config: {"type":"object","properties":{"children":{"type":"array","items":{"type":"string"}},"direction":{"type":"string","enum":["row","column"],"default":"column","description":"子元素排列方向"},"gap":{"type":"number","default":0,"description":"子元素之间的间距"}}}
</build_in_components>
`,
    parameters: {
      type: "object",
      properties: {
        components: {
          type: "array",
          description: "扁平化的组件节点数组。必须包含一个 id 为 'root' 的根节点。若组件支持嵌套子节点（声明了 props.children），在其 props.children 中传入子节点的 id 数组即可建立父子关系。",
          items: {
            type: "object",
            required: ["id", "component"],
            properties: {
              id: {
                type: "string",
                description: "节点唯一 ID。根节点必须为 'root'。",
              },
              component: {
                type: "string",
                enum: componetNames,
                description: "使用的组件名称。",
              },
              props: {
                type: "object",
                description: "传递给组件的参数（可选），具体字段依据组件定义。",
                additionalProperties: true,
              },
            },
          },
        }
      },
      required: ["components"],
    },
    validate(params: ToolParams) {
      const { components } = params
      const errors: string[] = []
      let hasRoot = false

      components.forEach(({ id, component }) => {
        if (!compnentNamesSet.has(component)) {
          errors.push(`Unknown component: "${component}".`)
        }
        if (id === 'root') {
          hasRoot = true
        }
      })

      if (!hasRoot) {
        errors.unshift(`Missing root component.`)
      }

      if (errors.length) {
        throw new Error(errors.join('\n') + `\nAvailable components: ${componetNames.join(", ")}`)
      }
    },
    async execute(params: ToolParams): Promise<any> {
      const { components: componentNodes } = params
      const canvasId = randomUUID()
      const apisDesc = componentNodes.reduce((pre, { id, component }) => {
        const componentDef = components[component]
        const apis = componentDef?.apis
        const componentApisDesc = apis && apis.length > 0
          ? apis.map((api) => `    - ${api.name}: ${api.description}`).join('\n')
          : '    （该组件未声明任何 API）'

        return `${pre}  - componentId: ${id}, component: ${component}\n${componentApisDesc}\n`
      }, '')

      return {
        output: `画布已渲染。
canvasId: ${canvasId}
可通过 call_canvas_component_api 调用以下组件 API：
${apisDesc}注意：componentId 对应 render_canvas 入参 components 中的 id；调用 API 前请使用上述 canvasId。`,
        metadata: {
          canvasId,
          params,
          success: true
        }
      }
    },
    render: (tool) => {
      const loading = tool?.status === 'pending';
      const canvasId = tool?.result?.metadata?.canvasId;
      const params = tool?.result?.metadata?.params;

      return (
        <div style={{ marginBottom: 12 }}>
          <CanvasRender
            canvasId={canvasId}
            loading={loading}
            params={params}
            components={components}
            agent={props.agent}
          />
        </div>
      )
    }
  }
}

export { createRenderCanvasTool }
