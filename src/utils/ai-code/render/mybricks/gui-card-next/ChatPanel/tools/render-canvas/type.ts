
export type ToolParams = {
  components: RenderCanvasComponentNode[]
}

interface RenderCanvasComponentNode {
  /** 节点唯一 ID。根节点必须为 'root'。 */
  id: string
  /** 使用的组件名称。 */
  component: string
  /** 传递给组件的参数（可选），具体字段依据组件定义。 */
  props?: Record<string, unknown>
}
