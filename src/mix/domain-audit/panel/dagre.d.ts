declare module 'dagre' {
  export namespace graphlib {
    class Graph {
      constructor(options?: { multigraph?: boolean })
      setGraph(value: Record<string, unknown>): this
      setDefaultEdgeLabel(value: () => Record<string, unknown>): this
      setNode(id: string, value: { width: number; height: number }): this
      setEdge(source: string, target: string, value: Record<string, unknown>, name?: string): this
      node(id: string): { x: number; y: number; width: number; height: number }
      edge(source: string, target: string, name?: string): { points: Array<{ x: number; y: number }> } | undefined
      graph(): { width: number; height: number }
    }
  }
  export function layout(graph: graphlib.Graph): void
}
