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

/** Arrange a spanning forest around a central root; retain every original edge. */
export function layoutMindMap(nodes: LayoutNode[], edges: LayoutEdge[]) {
  const ids = new Set(nodes.map(node => node.id))
  const outgoing = new Map(nodes.map(node => [node.id, [] as string[]]))
  const incoming = new Set<string>()
  edges.forEach(edge => {
    if (ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to) {
      outgoing.get(edge.from)!.push(edge.to)
      incoming.add(edge.to)
    }
  })
  let root = '__domain_mindmap_root__'
  while (ids.has(root)) root += '_'
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 100, marginx: MARGIN, marginy: MARGIN })
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setNode(root, { width: NODE_WIDTH, height: NODE_HEIGHT })
  nodes.forEach(node => graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  const visited = new Set<string>()
  const roots: string[] = []
  const visit = (id: string) => {
    visited.add(id)
    for (const child of outgoing.get(id) || []) {
      if (!visited.has(child)) { graph.setEdge(id, child); visit(child) }
    }
  }
  const candidates = [...nodes.filter(node => !incoming.has(node.id)), ...nodes]
  candidates.forEach(node => {
    if (!visited.has(node.id)) { roots.push(node.id); graph.setEdge(root, node.id); visit(node.id) }
  })
  dagre.layout(graph)
  const position = (id: string) => {
    const point = graph.node(id)
    return { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 }
  }
  const positions = new Map(nodes.map(node => [node.id, position(node.id)]))
  const rootPosition = position(root)
  const route = (from: Point, to: Point, self = false) => {
    if (self) return { path: `M ${from.x + 190} ${from.y + 18} C ${from.x + 230} ${from.y - 20}, ${from.x + 230} ${from.y + 76}, ${from.x + 190} ${from.y + 40}`, label: { x: from.x + 222, y: from.y } }
    const forward = to.x > from.x
    const x1 = from.x + (forward ? NODE_WIDTH : 0); const x2 = to.x + (forward ? 0 : NODE_WIDTH)
    const y1 = from.y + NODE_HEIGHT / 2; const y2 = to.y + NODE_HEIGHT / 2
    const middle = (x1 + x2) / 2
    return { path: `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`, label: { x: middle, y: (y1 + y2) / 2 } }
  }
  const paths = edges.map(edge => {
    const from = positions.get(edge.from); const to = positions.get(edge.to)
    return from && to ? route(from, to, edge.from === edge.to) : null
  })
  const rootPaths = roots.map(id => route(rootPosition, positions.get(id)!))
  const size = graph.graph()
  return { positions, paths, rootPosition, rootPaths, width: Math.max(260, size.width || 0), height: Math.max(200, size.height || 0) }
}
