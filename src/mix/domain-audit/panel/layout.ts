import * as dagre from 'dagre'

const NODE_WIDTH = 190
const NODE_HEIGHT = 56
const MARGIN = 28

type Point = { x: number; y: number }
type LayoutNode = { id: string }
type LayoutEdge = { from: string; to: string }

/** Layout only; graph semantics and content remain in the domain document. */
export function layoutDomainGraph(nodes: LayoutNode[], edges: LayoutEdge[]) {
  const graph = new dagre.graphlib.Graph({ multigraph: true })
  graph.setGraph({ rankdir: 'TB', nodesep: 42, ranksep: 65, edgesep: 16, marginx: MARGIN, marginy: MARGIN })
  graph.setDefaultEdgeLabel(() => ({}))
  const ids = new Set(nodes.map(node => node.id))
  nodes.forEach(node => graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach((edge, index) => {
    if (ids.has(edge.from) && ids.has(edge.to)) graph.setEdge(edge.from, edge.to, {}, String(index))
  })
  if (nodes.length) dagre.layout(graph)
  const positions = new Map<string, Point>()
  nodes.forEach(node => {
    const position = graph.node(node.id)
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) positions.set(node.id, { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 })
  })
  const paths = edges.map((edge, index) => {
    const points = graph.edge(edge.from, edge.to, String(index))?.points
    return points?.length ? { path: points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '), label: points[Math.floor(points.length / 2)] } : null
  })
  const size = graph.graph()
  return { positions, paths, width: Math.max(260, size.width || 0), height: Math.max(200, size.height || 0) }
}

/** The overview is a fixed set of visual lanes, not a hierarchy inferred from edges. */
export function layoutLayeredOverview(nodes: Array<LayoutNode & { type: string }>, edges: LayoutEdge[]) {
  const categories = ['domain', 'module', 'page', 'other', 'flow']
  const category = (node: { type: string }) => ['domain', 'module', 'page', 'flow'].includes(node.type) ? node.type : 'other'
  const groups = categories.map(type => ({ type, nodes: nodes.filter(node => category(node) === type) })).filter(group => group.nodes.length)
  const positions = new Map<string, Point>()
  const bands = groups.map((group, row) => {
    const top = 20 + row * 140
    group.nodes.forEach((node, index) => positions.set(node.id, { x: 152 + index * 225, y: top + 38 }))
    return { type: group.type, y: top, count: group.nodes.length }
  })
  const width = Math.max(390, ...groups.map(group => 152 + group.nodes.length * 225 + 24))
  const height = Math.max(200, 20 + groups.length * 140)
  const paths = edges.map(edge => {
    const from = positions.get(edge.from); const to = positions.get(edge.to)
    if (!from || !to) return null
    let path: string
    let label: Point
    if (edge.from === edge.to) {
      path = `M ${from.x + 190} ${from.y + 18} C ${from.x + 218} ${from.y - 8}, ${from.x + 218} ${from.y + 64}, ${from.x + 190} ${from.y + 40}`
      label = { x: from.x + 210, y: from.y + 12 }
    } else if (from.y === to.y) {
      const right = to.x > from.x
      const x1 = from.x + (right ? 190 : 0); const x2 = to.x + (right ? 0 : 190)
      const y = from.y - 14
      path = `M ${x1} ${from.y + 18} L ${x1} ${y} L ${x2} ${y} L ${x2} ${to.y + 18}`
      label = { x: (x1 + x2) / 2, y }
    } else {
      const down = to.y > from.y
      const x1 = from.x + 95; const y1 = from.y + (down ? NODE_HEIGHT : 0)
      const x2 = to.x + 95; const y2 = to.y + (down ? 0 : NODE_HEIGHT)
      const middle = (y1 + y2) / 2
      if (Math.abs(to.y - from.y) > 140) {
        const exit = y1 + (down ? 16 : -16); const entry = y2 + (down ? -16 : 16)
        path = `M ${x1} ${y1} L ${x1} ${exit} L 136 ${exit} L 136 ${entry} L ${x2} ${entry} L ${x2} ${y2}`
        label = { x: 136, y: (exit + entry) / 2 }
      } else {
        path = `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`
        label = { x: (x1 + x2) / 2, y: middle }
      }
    }
    return { path, label }
  })
  return { positions, paths, bands, width, height }
}
