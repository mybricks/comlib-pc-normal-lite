import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Background, BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, useNodesInitialized, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from 'reactflow'
import { throttle } from 'throttle-debounce'
import 'reactflow/dist/style.css'
import { getLazyCss } from '../../lowcodeView/utils/css'
import * as lazyCss from '../index.lazy.less'
import { copy } from '../index.i18n'
import { createFlowLayout, edgeLabelSize, roundedPath } from './layout'
import { hideRelationRoot, parseDiagram, type ParsedDiagram, type DiagramNode as ParsedNode } from './parse'
import { buildNodeHints, type ZoneHint } from './ui-selector'

const css = getLazyCss(lazyCss)
const RESIZE_THROTTLE_MS = 30
const PREVIEW_PADDING = 0.05

type BusinessNodeData = { label: string; shape: string; depth: number; width: number; height: number; direction: ParsedDiagram['direction']; ui?: ParsedNode['ui']; source?: ParsedNode['source']; field?: ParsedNode['field']; hint?: ZoneHint; selectionScope: string; onSelect: (id: string, hint: ZoneHint, doc: Document) => void }
type RoutedEdgeData = { points: Array<{ x: number; y: number }>; labelPosition?: { x: number; y: number }; junction?: { x: number; y: number } }
type BusinessNode = Node<BusinessNodeData, 'business'>
type RoutedEdge = Edge<RoutedEdgeData>

function DiagramNode({ id, data, selected }: NodeProps<BusinessNodeData>) {
  const vertical = data.direction === 'TB' || data.direction === 'BT'
  const reverse = data.direction === 'BT' || data.direction === 'RL'
  const source = vertical ? (reverse ? Position.Top : Position.Bottom) : (reverse ? Position.Left : Position.Right)
  const target = vertical ? (reverse ? Position.Bottom : Position.Top) : (reverse ? Position.Right : Position.Left)
  const kind = data.ui?.length ? 'ui' : data.source ? 'source' : data.field ? 'field' : undefined
  const meta = data.source?.bind ?? data.field?.bind
  const selectable = !!data.hint
  const special = !!kind && data.shape !== 'decision'
  const kindLabel = kind === 'source' ? copy.nodeSource() : kind === 'field' ? copy.nodeField() : copy.nodeUi()
  const select = (doc: Document) => { if (data.hint) data.onSelect(id, data.hint, doc) }
  return <div style={{ width: data.width, height: data.height }} data-kind={kind} data-understand-selectable={selectable ? data.selectionScope : undefined} role={selectable ? 'button' : undefined} aria-pressed={selectable ? selected : undefined} tabIndex={selectable ? 0 : undefined} onClick={selectable ? event => { event.stopPropagation(); select(event.currentTarget.ownerDocument) } : undefined} onKeyDown={selectable ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(event.currentTarget.ownerDocument) } } : undefined} className={[css['bizgraph-node'], data.shape === 'round' && css['bizgraph-round'], data.shape === 'decision' && css['bizgraph-decision'], data.depth === 0 && css['bizgraph-root'], selected && css['bizgraph-selected'], selectable && css['bizgraph-linked']].filter(Boolean).join(' ')}>
    <Handle type="target" position={target} />
    {kind && <div className={css['bizgraph-kind']} data-kind={kind}>
      <svg className={css['bizgraph-kind-icon']} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === 'source' ? <><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v7c0 1.1 2.24 2 5 2s5-.9 5-2V4M3 7.5c0 1.1 2.24 2 5 2s5-.9 5-2" /></> : kind === 'field' ? <><path d="M5 2.5H4c-.6 0-1 .4-1 1v3c0 .8-.4 1.5-1 1.5.6 0 1 .7 1 1.5v3c0 .6.4 1 1 1h1M11 2.5h1c.6 0 1 .4 1 1v3c0 .8.4 1.5 1 1.5-.6 0-1 .7-1 1.5v3c0 .6-.4 1-1 1h-1M6.3 6.3l3.4 3.4m0-3.4-3.4 3.4" /></> : <path d="M8 1.75 13.25 4.8v6.4L8 14.25 2.75 11.2V4.8L8 1.75ZM2.95 4.9 8 7.85l5.05-2.95M8 7.85v6.1" />}
      </svg>
      {special && <span>{kindLabel}</span>}
    </div>}
    <div className={css['bizgraph-content']} data-meta={meta ? 'true' : undefined}><span className={css['bizgraph-label']} title={data.label}>{data.label}</span>{meta && <span className={css['bizgraph-meta']} title={meta}>{meta}</span>}</div>
    <Handle type="source" position={source} />
  </div>
}

function DiagramEdge({ id, data, label, style, markerEnd }: EdgeProps<RoutedEdgeData>) {
  if (!data?.points.length) return null
  const position = data.labelPosition
  const nearest = position && data.points.slice(1).reduce<{ x: number; y: number; distance: number } | undefined>((best, end, index) => {
    const start = data.points[index], dx = end.x - start.x, dy = end.y - start.y
    const length = dx * dx + dy * dy
    const t = length ? Math.max(0, Math.min(1, ((position.x - start.x) * dx + (position.y - start.y) * dy) / length)) : 0
    const x = start.x + t * dx, y = start.y + t * dy, distance = Math.hypot(x - position.x, y - position.y)
    return !best || distance < best.distance ? { x, y, distance } : best
  }, undefined)
  return <>
    {position && nearest && nearest.distance > 14 && <line x1={nearest.x} y1={nearest.y} x2={position.x} y2={position.y} stroke="var(--mybricks-text-color-secondary, #8a909d)" strokeWidth={1} strokeDasharray="2 3" />}
    <BaseEdge id={id} path={data.junction ? `M ${data.points[0].x} ${data.points[0].y} L ${data.junction.x} ${data.junction.y} ${roundedPath(data.points.slice(1))}` : roundedPath(data.points)} style={style} markerEnd={markerEnd} label={label} labelX={position?.x} labelY={position?.y} labelStyle={{ fill: 'var(--mybricks-text-color-secondary, #697386)', fontSize: 12 }} labelShowBg labelBgPadding={[4, 2]} />
    {data.junction && <circle cx={data.junction.x} cy={data.junction.y} r={3} fill="var(--mybricks-text-color-secondary, #8a909d)" />}
  </>
}

function LabelExtent() { return null }
const nodeTypes = { business: DiagramNode, labelExtent: LabelExtent }
const edgeTypes = { routed: DiagramEdge }

function FitOnResize({ container }: { container: React.RefObject<HTMLDivElement> }) {
  const { fitView } = useReactFlow()
  const initialized = useNodesInitialized()

  useEffect(() => {
    const element = container.current
    if (!element || !initialized) return
    let frame = 0
    const fit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (element.clientWidth > 0 && element.clientHeight > 0) {
          void fitView({ padding: PREVIEW_PADDING, maxZoom: 1 })
        }
      })
    }
    const onResize = throttle(RESIZE_THROTTLE_MS, fit)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
    observer?.observe(element)
    fit()
    return () => { observer?.disconnect(); onResize.cancel(); cancelAnimationFrame(frame) }
  }, [container, fitView, initialized])
  return null
}

function DiagramFallback({ content, renderError = false }: { content: string; renderError?: boolean }) {
  const source = content.match(/```mermaid[^\n]*\n([\s\S]*?)```/i)?.[1] ?? content
  return <pre className={css['bizai-document']} role="status">{renderError && <>{copy.diagramRenderError()}{'\n'}</>}{source}</pre>
}

function MermaidFallback({ content }: { content: string }) {
  const [svg, setSvg] = useState('')
  const source = content.match(/```mermaid[^\n]*\n([\s\S]*?)```/i)?.[1] ?? content
  useEffect(() => {
    let active = true
    const mermaid = (window as any).mermaid
    if (mermaid) {
      const id = `understand-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`
      void Promise.resolve().then(() => mermaid.render(id, source)).then((result: { svg: string }) => { if (active) setSvg(result.svg) }).catch(() => {})
    }
    return () => { active = false }
  }, [source])
  return svg ? <div className={css['bizai-diagram']} dangerouslySetInnerHTML={{ __html: svg }} /> : <DiagramFallback content={content} />
}

class DiagramErrorBoundary extends React.Component<{ content: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[understand-any] Diagram render failed', error, info)
  }

  render() {
    return this.state.failed ? <DiagramFallback content={this.props.content} renderError /> : this.props.children
  }
}

function DiagramContent({ content, interactive = false, selectedNode, selectionScope, onSelect }: { content: string; interactive?: boolean; selectedNode: string | null; selectionScope: string; onSelect: (id: string, hint: ZoneHint, doc: Document) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const [direction, setDirection] = useState<'LR' | 'TB'>('TB')
  const graphs = useMemo(() => {
    try {
      const diagram = hideRelationRoot(parseDiagram(content))
      const hints = buildNodeHints(diagram)
      const build = (direction: ParsedDiagram['direction']) => {
        const layout = createFlowLayout({ ...diagram, direction })
        const nodes: BusinessNode[] = layout.nodes.map(node => ({ id: node.id, type: 'business', position: node.position, data: { label: node.label, shape: node.shape, depth: node.depth ?? -1, width: node.width, height: node.height, direction, ui: node.ui, source: node.source, field: node.field, hint: hints.get(node.id), selectionScope, onSelect }, draggable: false, ...(hints.has(node.id) ? { style: { pointerEvents: 'all' } } : {}) }))
        const ids = new Set(nodes.map(node => node.id))
        const labelBounds: Node[] = layout.edges.flatMap((edge, index) => {
          if (!edge.label || !edge.labelPosition) return []
          const size = edgeLabelSize(edge.label)
          let id = `__label_extent_${index}`
          while (ids.has(id)) id = `_${id}`
          ids.add(id)
          return [{ id, type: 'labelExtent', position: { x: edge.labelPosition.x - size.width / 2, y: edge.labelPosition.y - size.height / 2 }, data: {},
            style: { width: size.width, height: size.height, visibility: 'hidden', pointerEvents: 'none' }, draggable: false, selectable: false, focusable: false }]
        })
        const edges: RoutedEdge[] = layout.edges.map((edge, index) => ({
          id: `edge-${index}`, source: edge.source, target: edge.target, type: 'routed', label: edge.label,
          data: { points: edge.points, labelPosition: edge.labelPosition, junction: edge.junction },
          style: { stroke: 'var(--mybricks-text-color-secondary, #8a909d)', strokeWidth: 1.5, ...(edge.dashed ? { strokeDasharray: '5 4' } : {}) },
          ...(edge.arrow ? { markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--mybricks-text-color-secondary, #8a909d)' } } : {}),
        }))
        const boxes = [...layout.nodes.map(node => ({ ...node.position, width: node.width, height: node.height })),
          ...labelBounds.map(node => ({ ...node.position, width: Number(node.style?.width), height: Number(node.style?.height) }))]
        const width = Math.max(...boxes.map(box => box.x + box.width)) - Math.min(...boxes.map(box => box.x))
        const height = Math.max(...boxes.map(box => box.y + box.height)) - Math.min(...boxes.map(box => box.y))
        return { nodes: [...nodes, ...labelBounds], edges, width, height }
      }
      const primary = build(diagram.direction)
      return { primary, vertical: diagram.kind === 'mindmap' ? build('TB') : null }
    } catch {
      return null
    }
  }, [content, interactive, selectionScope, onSelect])

  useLayoutEffect(() => {
    const element = container.current
    if (!element || !graphs?.vertical) return
    const horizontal = graphs.primary
    const vertical = graphs.vertical
    const update = () => {
      const width = element.clientWidth, height = element.clientHeight
      if (!width || !height) return
      const horizontalScale = Math.min(width / horizontal.width, height / horizontal.height, 1)
      const verticalScale = Math.min(width / vertical.width, height / vertical.height, 1)
      setDirection(current => {
        if (current === 'TB') return horizontalScale > verticalScale * 1.2 ? 'LR' : 'TB'
        return horizontalScale <= verticalScale * 1.1 ? 'TB' : 'LR'
      })
    }
    update()
    const onResize = throttle(RESIZE_THROTTLE_MS, update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
    observer?.observe(element)
    return () => { observer?.disconnect(); onResize.cancel() }
  }, [graphs])

  if (!graphs) return <MermaidFallback key={content} content={content} />
  const graph = direction === 'TB' && graphs.vertical ? graphs.vertical : graphs.primary
  return <div ref={container} className={css['bizai-flow']} data-interactive={interactive} style={!interactive ? { aspectRatio: `${graph.width} / ${graph.height}` } : undefined}>
    <ReactFlow key={`${content}-${graphs.vertical ? direction : ''}`} nodes={graph.nodes.map(node => node.type === 'business' ? { ...node, selected: node.id === selectedNode } : node)} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: interactive ? 0.15 : PREVIEW_PADDING, maxZoom: 1 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} nodesFocusable={false} edgesFocusable={false} panOnDrag={false} panOnScroll={interactive} zoomOnScroll={false} zoomOnPinch={interactive} zoomOnDoubleClick={interactive} preventScrolling={interactive} disableKeyboardA11y={!interactive} minZoom={0.1} maxZoom={2} proOptions={{ hideAttribution: true }}>
      <Background />
      {!interactive && <FitOnResize container={container} />}
      {interactive && <Controls showInteractive={false} aria-label={copy.diagramControls()} />}
    </ReactFlow>
  </div>
}

export function Diagram({ content, interactive = false, selectedNode, selectionScope, onSelect }: { content: string; interactive?: boolean; selectedNode: string | null; selectionScope: string; onSelect: (id: string, hint: ZoneHint, doc: Document) => void }) {
  return <DiagramErrorBoundary key={content} content={content}><DiagramContent content={content} interactive={interactive} selectedNode={selectedNode} selectionScope={selectionScope} onSelect={onSelect} /></DiagramErrorBoundary>
}
