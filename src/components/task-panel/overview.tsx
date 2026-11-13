import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import dagre from 'dagre'
import YAML from 'yaml'
import { Handle, Position, ReactFlow, getNodesBounds, getViewportForBounds, useReactFlow, useStore, type Edge, type Node, type NodeProps } from 'reactflow'
import 'reactflow/dist/style.css'
import { attachShadowStyles } from '../../mix/understand-any/shadow-styles'
import { getLazyCss } from '../../mix/lowcodeView/utils/css'
import { i18n, type TaskStatus } from './index.i18n'
import { TaskStatusBadge } from './status-badge'
import * as lazyCss from './index.lazy.less'

const css = getLazyCss(lazyCss)
type OverviewNode = { id: string; type: 'root' | 'page' | 'component'; title: string; file?: string; symbol?: string; tasks?: string[]; children: string[] }
type OverviewEntry = Omit<OverviewNode, 'type' | 'children'>
type OverviewComponent = OverviewEntry & { parent?: string | string[] }
type OverviewDocument = { root: OverviewNode; pages: OverviewNode[]; components: OverviewNode[] }
type Task = { id: string; title: string; status: TaskStatus }
type RelatedTask = { id: string; title: string; status?: TaskStatus }
type Direction = 'LR' | 'TB'
export type OverviewSelection = { kind: 'task'; id: string } | null

const NODE_WIDTH = 220
const NODE_HEADER_HEIGHT = 56
const TASK_ROW_HEIGHT = 26
const TASK_LIST_PADDING = 8
const MIN_ZOOM = 0.08
const FIT_PADDING = 0.18
const OVERVIEW_MAX_ZOOM = 1
const CANVAS_PADDING = 80
const FOCUS_PADDING = 24
const STATUS_ORDER: TaskStatus[] = ['待验证', '处理中', '待交接', '已完成']

function parseOverview(content: string): OverviewDocument {
  const doc = YAML.parse(content) as {
    version: number
    root: Omit<OverviewEntry, 'id'>
    pages: OverviewEntry[]
    components: OverviewComponent[]
  } | null
  const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string')
  const validEntry = (entry: Omit<OverviewEntry, 'id'>) => entry && typeof entry.title === 'string' && !!entry.title &&
    (entry.file === undefined || typeof entry.file === 'string') && (entry.symbol === undefined || typeof entry.symbol === 'string') &&
    (entry.tasks === undefined || strings(entry.tasks))
  if (doc?.version !== 2 || !validEntry(doc.root) || !Array.isArray(doc.pages) || !Array.isArray(doc.components)) {
    throw new Error('Invalid overview')
  }
  const root: OverviewNode = { ...doc.root, id: 'root', type: 'root', children: [] }
  const entries = [...doc.pages, ...doc.components]
  if (entries.some(entry => !validEntry(entry) || typeof entry.id !== 'string' || !entry.id.trim())) {
    throw new Error('Invalid overview node')
  }
  const pages: OverviewNode[] = doc.pages.map(page => ({ ...page, type: 'page', children: [] }))
  const components: OverviewNode[] = doc.components.map(({ parent: _parent, ...component }) => ({ ...component, type: 'component', children: [] }))
  const nodes = new Map([root, ...pages, ...components].map(node => [node.id, node]))
  if (nodes.size !== entries.length + 1) throw new Error('Duplicate overview node')

  for (const { id, parent } of doc.components) {
    if (parent === undefined) continue
    const parents = typeof parent === 'string' ? [parent] : parent
    if (!strings(parents)) throw new Error('Invalid parent references')
    for (const parentId of new Set(parents)) {
      const node = nodes.get(parentId)
      if (!node || parentId === id) throw new Error('Invalid parent reference')
      node.children.push(id)
    }
  }
  return { root, pages, components }
}

export function readOverview(content: string | null) {
  const nodes = new Map<string, OverviewNode>()
  if (!content?.trim()) return { doc: null, nodes, invalid: false }
  try {
    const doc = parseOverview(content)
    for (const node of [doc.root, ...doc.pages, ...doc.components]) nodes.set(node.id, node)
    return { doc, nodes, invalid: false }
  } catch {
    return { doc: null, nodes, invalid: true }
  }
}

function getNodeKind(kind: OverviewNode['type']) {
  if (kind === 'root') return i18n.overviewGlobal()
  return kind === 'page' ? i18n.overviewPage() : i18n.overviewComponent()
}

function NodeIcon({ kind }: { kind: OverviewNode['type'] }) {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'root' && <><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="12" y="3" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><rect x="12" y="12" width="5" height="5" rx="1" /></>}
      {kind === 'page' && <><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M3 7.5h14M6 11h5M6 13.5h8" /></>}
      {kind === 'component' && <><path d="M10 2.8 17 6.5v7L10 17.2l-7-3.7v-7L10 2.8Z" /><path d="m3.5 6.8 6.5 3.5 6.5-3.5M10 10.3v6.5" /></>}
    </svg>
  )
}

function TaskLink({ task, active, onSelect }: { task: RelatedTask; active: boolean; onSelect?: (id: string) => void }) {
  return (
    <button type="button" className={`${css['overview-task-link']} nodrag nopan`} data-active={active || undefined}
      data-mybricks-tip={task.title} disabled={!task.status} onClick={event => { event.stopPropagation(); onSelect?.(task.id) }}>
      <span className={css['overview-task-title']}>{task.title}</span>
      {task.status && <TaskStatusBadge status={task.status} />}
    </button>
  )
}

type GraphNodeData = {
  node: OverviewNode
  direction: Direction
  tasks: RelatedTask[]
  highlighted?: boolean
  ancestorHighlighted?: boolean
  muted?: boolean
  activeTask?: string
  onTask?: (id: string) => void
}

function GraphNode({ data }: NodeProps<GraphNodeData>) {
  const { node, direction, tasks, activeTask } = data
  return (
    <div className={`${css['overview-node']} nopan`} data-kind={node.type} data-highlighted={data.highlighted || undefined}
      data-ancestor-highlighted={data.ancestorHighlighted || undefined} data-muted={data.muted || undefined}>
      <Handle type="target" position={direction === 'LR' ? Position.Left : Position.Top} />
      <div className={css['overview-node-heading']} data-mybricks-tip={node.title}>
        <span className={css['overview-node-icon']}><NodeIcon kind={node.type} /></span>
        <span className={css['overview-node-label']}>
          <span>{getNodeKind(node.type)}</span>
          <strong>{node.title}</strong>
        </span>
      </div>
      {tasks.length > 0 && (
        <div className={css['overview-node-tasks']}>
          {tasks.map(task => <TaskLink key={task.id} task={task} active={task.id === activeTask} onSelect={data.onTask} />)}
        </div>
      )}
      <Handle type="source" position={direction === 'LR' ? Position.Right : Position.Bottom} />
    </div>
  )
}

const nodeTypes = { overview: GraphNode }

function getRelatedTasks(node: OverviewNode | undefined, tasks: Map<string, Task>): RelatedTask[] {
  return Array.from(new Set(node?.tasks ?? []))
    .map(id => tasks.get(id) ?? { id, title: id, status: undefined })
    .sort((a, b) => {
      const rank = (status?: TaskStatus) => status ? STATUS_ORDER.indexOf(status) : STATUS_ORDER.length
      return rank(a.status) - rank(b.status)
    })
}

function getNodeHeight(taskCount: number) {
  return NODE_HEADER_HEIGHT + (taskCount ? TASK_LIST_PADDING + taskCount * TASK_ROW_HEIGHT : 0)
}

function buildGraph(doc: OverviewDocument, tasks: Map<string, Task>, direction: Direction) {
  const nodes: Node<GraphNodeData>[] = []
  const edges: Edge[] = []
  const components = new Map(doc.components.map(component => [component.id, component]))
  const graph = new dagre.graphlib.Graph().setGraph({ rankdir: direction, nodesep: 20, ranksep: 52 }).setDefaultEdgeLabel(() => ({}))
  const addNode = (id: string, node: OverviewNode, parent?: string) => {
    const related = getRelatedTasks(node, tasks)
    graph.setNode(id, { width: NODE_WIDTH, height: getNodeHeight(related.length) })
    // React Flow disables pointer events on non-selectable, non-draggable nodes by default.
    // Keep the node itself non-selectable while allowing its task buttons to receive input.
    nodes.push({ id, type: 'overview', position: { x: 0, y: 0 }, style: { pointerEvents: 'all' }, data: { node, tasks: related, direction } })
    if (parent) {
      graph.setEdge(parent, id, {})
      edges.push({ id: `${parent}-to-${id}`, source: parent, target: id, type: 'smoothstep' })
    }
  }
  const addComponents = (parent: string, ids: string[], ancestors = new Set<string>()) => {
    for (const id of new Set(ids)) {
      const component = components.get(id)
      if (!component || ancestors.has(id)) continue
      const graphId = `${parent}/component/${encodeURIComponent(id)}`
      addNode(graphId, component, parent)
      ancestors.add(id)
      addComponents(graphId, component.children, ancestors)
      ancestors.delete(id)
    }
  }
  addNode('root', doc.root)
  addComponents('root', doc.root.children)
  for (const page of doc.pages) {
    const id = `page/${encodeURIComponent(page.id)}`
    addNode(id, page, 'root')
    addComponents(id, page.children)
  }
  dagre.layout(graph)
  for (const node of nodes) {
    const { x, y, width, height } = graph.node(node.id)
    node.position = { x: x - width / 2, y: y - height / 2 }
  }
  const { width, height } = graph.graph()
  return { nodes, edges, width, height }
}

function FitOverview({ graph, taskFocus, focusIds }: {
  graph: ReturnType<typeof buildGraph>
  taskFocus: OverviewSelection
  focusIds: ReadonlySet<string>
}) {
  const { getViewport, setViewport, viewportInitialized } = useReactFlow()
  const width = useStore(state => state.width)
  const height = useStore(state => state.height)
  useEffect(() => {
    if (!viewportInitialized || !width || !height) return
    const frame = requestAnimationFrame(() => {
      const bounds = getNodesBounds(graph.nodes.map(node => ({
        ...node,
        width: NODE_WIDTH,
        height: getNodeHeight(node.data.tasks.length),
      })))
      void setViewport(getViewportForBounds(bounds, width, height, MIN_ZOOM, OVERVIEW_MAX_ZOOM, FIT_PADDING))
    })
    return () => cancelAnimationFrame(frame)
  }, [viewportInitialized, graph, width, height, setViewport])

  useEffect(() => {
    if (!viewportInitialized || !width || !height || !taskFocus || !focusIds.size) return
    const frame = requestAnimationFrame(() => {
      const bounds = getNodesBounds(graph.nodes.filter(node => focusIds.has(node.id)).map(node => ({
        ...node,
        width: NODE_WIDTH,
        height: getNodeHeight(node.data.tasks.length),
      })))
      const current = getViewport()
      const padding = Math.min(FOCUS_PADDING, width / 4, height / 4)
      const left = bounds.x * current.zoom + current.x
      const top = bounds.y * current.zoom + current.y
      const right = left + bounds.width * current.zoom
      const bottom = top + bounds.height * current.zoom
      // Padding is useful when revealing off-screen nodes, but should not move
      // nodes that are already fully visible near the edge of the viewport.
      if (left >= 0 && top >= 0 && right <= width && bottom <= height) return

      const fits = bounds.width * current.zoom <= width - padding * 2 && bounds.height * current.zoom <= height - padding * 2
      const viewport = fits ? {
        ...current,
        x: current.x + (left < padding ? padding - left : right > width - padding ? width - padding - right : 0),
        y: current.y + (top < padding ? padding - top : bottom > height - padding ? height - padding - bottom : 0),
      } : getViewportForBounds(bounds, width, height, MIN_ZOOM, current.zoom, FIT_PADDING)
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
      void setViewport(viewport, { duration })
    })
    return () => cancelAnimationFrame(frame)
  }, [viewportInitialized, graph, taskFocus, focusIds, width, height, getViewport, setViewport])
  return null
}

function LocateOverview({ graph }: { graph: ReturnType<typeof buildGraph> }) {
  const { setViewport } = useReactFlow()
  const width = useStore(state => state.width)
  const height = useStore(state => state.height)
  const locate = () => {
    if (!width || !height) return
    const bounds = getNodesBounds(graph.nodes.map(node => ({
      ...node,
      width: NODE_WIDTH,
      height: getNodeHeight(node.data.tasks.length),
    })))
    const viewport = getViewportForBounds(bounds, width, height, MIN_ZOOM, OVERVIEW_MAX_ZOOM, FIT_PADDING)
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    void setViewport(viewport, { duration })
  }
  return (
    <button type="button" className={css['overview-locate']} onClick={locate}
      title={i18n.overviewLocate()} aria-label={i18n.overviewLocate()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    </button>
  )
}

export default function TaskOverview({ overview, tasks, selection, onSelect, onTaskClick }: {
  overview: ReturnType<typeof readOverview>
  tasks: Task[]
  selection: OverviewSelection
  onSelect: (selection: OverviewSelection) => void
  onTaskClick: (id: string) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [direction, setDirection] = useState<Direction>('TB')
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const taskMap = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const { doc } = overview
  const graphs = useMemo(() => doc ? {
    LR: buildGraph(doc, taskMap, 'LR'),
    TB: buildGraph(doc, taskMap, 'TB'),
  } : null, [doc, taskMap])

  useLayoutEffect(() => attachShadowStyles(document), [])
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !graphs) return
    const update = () => {
      const { clientWidth: width, clientHeight: height } = canvas
      if (!width || !height) return
      setCanvasSize(current => current.width === width && current.height === height ? current : { width, height })
      const scale = (graph: typeof graphs.LR) => Math.min(width / graph.width, height / graph.height)
      const horizontal = scale(graphs.LR)
      const vertical = scale(graphs.TB)
      // Prefer vertical and keep a gap between thresholds to avoid flicker.
      setDirection(current => current === 'LR'
        ? (horizontal < vertical * 1.18 ? 'TB' : 'LR')
        : (horizontal > vertical * 1.3 ? 'LR' : 'TB'))
    }
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined
    observer?.observe(canvas)
    return () => observer?.disconnect()
  }, [graphs])

  const graph = graphs?.[direction]
  const translateExtent = useMemo<[[number, number], [number, number]] | undefined>(() => {
    if (!graph) return undefined
    const bounds = getNodesBounds(graph.nodes.map(node => ({
      ...node,
      width: NODE_WIDTH,
      height: getNodeHeight(node.data.tasks.length),
    })))
    // Keep some travel in each direction even when the entire graph fits in the viewport.
    const extentWidth = Math.max(bounds.width + CANVAS_PADDING * 2, (canvasSize.width + CANVAS_PADDING * 2) / zoom)
    const extentHeight = Math.max(bounds.height + CANVAS_PADDING * 2, (canvasSize.height + CANVAS_PADDING * 2) / zoom)
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    return [
      [centerX - extentWidth / 2, centerY - extentHeight / 2],
      [centerX + extentWidth / 2, centerY + extentHeight / 2],
    ]
  }, [graph, canvasSize, zoom])
  const taskFocus = selection?.kind === 'task' ? selection : null
  const activeTask = taskFocus?.id
  const { directIds, ancestorIds, focusIds } = useMemo(() => {
    const directIds = new Set<string>()
    const ancestorIds = new Set<string>()
    if (activeTask && graph) {
      for (const { id, data } of graph.nodes) {
        if (data.tasks.some(task => task.id === activeTask)) directIds.add(id)
      }
      const parents = new Map(graph.edges.map(({ source, target }) => [target, source]))
      for (const id of directIds) {
        let parent = parents.get(id)
        while (parent && !ancestorIds.has(parent)) {
          ancestorIds.add(parent)
          parent = parents.get(parent)
        }
      }
    }
    return { directIds, ancestorIds, focusIds: new Set([...directIds, ...ancestorIds]) }
  }, [graph, activeTask])
  const hasMatches = directIds.size > 0
  const footerText = activeTask && !hasMatches ? i18n.overviewNoImpact() : null
  const selectTask = (id: string) => onTaskClick(id)
  const nodes = graph?.nodes.map(node => {
    const highlighted = Boolean(activeTask && directIds.has(node.id))
    const ancestorHighlighted = !highlighted && ancestorIds.has(node.id)
    const muted = hasMatches && !highlighted && !ancestorHighlighted
    return { ...node, data: { ...node.data, activeTask, highlighted, ancestorHighlighted, muted, onTask: selectTask } }
  })
  const edges = hasMatches ? graph?.edges.map(edge => (
    focusIds.has(edge.source) && focusIds.has(edge.target)
      ? { ...edge, className: css['overview-edge-highlighted'] }
      : edge
  )) : graph?.edges

  return (
    <section className={css['overview-body']} aria-label={i18n.overviewView()}>
      {graph ? (
        <div ref={canvasRef} className={css['overview-canvas']}>
          <ReactFlow key={direction} nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
            panOnDrag={false} panOnScroll zoomOnScroll={false}
            translateExtent={translateExtent}
            onMove={(_, viewport) => setZoom(current => current === viewport.zoom ? current : viewport.zoom)}
            onPaneClick={() => onSelect(null)}
            minZoom={MIN_ZOOM} maxZoom={2} proOptions={{ hideAttribution: true }}>
            <FitOverview graph={graph} taskFocus={taskFocus} focusIds={focusIds} />
            <LocateOverview graph={graph} />
          </ReactFlow>
        </div>
      ) : <div className={css['overview-empty']} role="status">{overview.invalid ? i18n.overviewInvalid() : i18n.overviewEmpty()}</div>}
      {graph && footerText && (
        <div className={css['overview-footer']} role="status" title={footerText}>{footerText}</div>
      )}
    </section>
  )
}
