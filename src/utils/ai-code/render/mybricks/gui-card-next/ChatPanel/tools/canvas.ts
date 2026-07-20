export type ComponentApis = Record<string, (params?: any) => any>
export type Component = {
  apis: ComponentApis
}

export type ComponentApiCall = {
  name: string
  params?: any
}

export class Canvas {
  canvasMap: Map<
    string,
    Map<string, Component>
  > = new Map()
}

export default new Canvas()
