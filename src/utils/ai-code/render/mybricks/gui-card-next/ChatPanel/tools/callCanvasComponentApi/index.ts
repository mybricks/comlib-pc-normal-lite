import canvasClass, { type ComponentApiCall } from '../canvas'

async function callComponentApis(canvasId: string, componentId: string, apiCalls: ComponentApiCall[]) {
  const canvas = canvasClass.canvasMap.get(canvasId)
  const results: Record<string, any> = {}

  if (!canvas) {
    results._error = `画布 "${canvasId}" 不存在`
    return results
  }

  const component = canvas.get(componentId)

  if (!component) {
    results._error = `组件 "${componentId}" 不存在于画布 "${canvasId}" 中`
    return results
  }

  await Promise.all(apiCalls.map(async ({ name, params }) => {
    const handler = component.apis?.[name]

    if (!handler) {
      results[name] = `[error] API "${name}" 不存在于组件 "${componentId}" 中`
      return
    }

    try {
      results[name] = await handler(params)
    } catch (err) {
      results[name] = `[error] ${err instanceof Error ? err.message : String(err)}`
    }
  }))

  return results
}

type Tool = any
type ToolResult = any

export const CALL_CANVAS_COMPONENT_API_TOOL_NAME = 'call_canvas_component_api'

interface CallCanvasComponentApiParams {
  canvasId?: string
  componentId?: string
  apiCalls?: ComponentApiCall[]
}

export function createCallCanvasComponentApiTool(): Tool {
  return {
    name: CALL_CANVAS_COMPONENT_API_TOOL_NAME,
    title: '调用画布组件 API',
    description: `调用指定 canvasId 画布内某个组件节点通过 useExposeApi 注册的 API，获取组件内部状态或数据。
使用前请先通过 render_canvas 渲染画布，并从返回信息中获取 canvasId、componentId 与可用 API 名称。
注意：此工具用于调用已渲染画布内组件暴露的 API；若用户要求重新生成或重新渲染画布，应重新调用 render_canvas。`,
    parameters: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: '目标画布的唯一实例 id，从 render_canvas 返回信息中获取',
        },
        componentId: {
          type: 'string',
          description: '目标组件节点 id，对应 render_canvas 入参 components 中的 id',
        },
        apiCalls: {
          type: 'array',
          description: '要调用的 API 列表。name 为 API 名称；params 为传给该 API 的参数，可选。',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: {
                type: 'string',
                description: '要调用的 API 名称',
              },
              params: {
                description: '传给 API 的参数，可选，具体结构由组件 API 定义决定',
              },
            },
          },
        },
      },
      required: ['canvasId', 'componentId', 'apiCalls'],
    },
    validate(params: CallCanvasComponentApiParams) {
      if (!params.canvasId || typeof params.canvasId !== 'string' || !params.canvasId.trim()) {
        throw new Error('canvasId is required and must be a non-empty string')
      }
      if (!params.componentId || typeof params.componentId !== 'string' || !params.componentId.trim()) {
        throw new Error('componentId is required and must be a non-empty string')
      }
      if (!Array.isArray(params.apiCalls) || params.apiCalls.length === 0) {
        throw new Error('apiCalls must be a non-empty array')
      }
      params.apiCalls.forEach((apiCall, index) => {
        if (!apiCall || typeof apiCall.name !== 'string' || !apiCall.name.trim()) {
          throw new Error(`apiCalls[${index}].name is required and must be a non-empty string`)
        }
      })
    },
    async execute(params: Required<CallCanvasComponentApiParams>): Promise<ToolResult> {
      const results = await callComponentApis(params.canvasId, params.componentId, params.apiCalls)

      if ('_error' in results) {
        return {
          output: `调用失败：${results._error}`,
          metadata: {
            success: false,
            canvasId: params.canvasId,
            componentId: params.componentId,
            results,
          },
        }
      }

      const lines = Object.entries(results).map(
        ([api, value]) => `  - ${api}: ${JSON.stringify(value)}`
      )

      return {
        output: `画布组件 API 调用结果（canvasId: ${params.canvasId}, componentId: ${params.componentId}）：\n${lines.join('\n')}`,
        metadata: {
          success: true,
          canvasId: params.canvasId,
          componentId: params.componentId,
          results,
        },
      }
    },
  }
}
