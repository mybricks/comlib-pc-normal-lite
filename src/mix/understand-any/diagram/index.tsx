import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Background, BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, useNodesInitialized, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from 'reactflow'
import { throttle } from 'throttle-debounce'
import 'reactflow/dist/style.css'
import { getLazyCss } from '../../lowcodeView/utils/css'
import * as lazyCss from '../index.lazy.less'
import { copy } from '../index.i18n'
import { createFlowLayout, roundedPath } from './layout'
import { parseDiagram, type ParsedDiagram } from './parse'

const css = getLazyCss(lazyCss)
const RESIZE_THROTTLE_MS = 30

type BusinessNodeData = { label: string; shape: string; depth: number; direction: ParsedDiagram['direction'] }
type RoutedEdgeData = { points: Array<{ x: number; y: number }>; labelPosition?: { x: number; y: number } }
type BusinessNode = Node<BusinessNodeData, 'business'>
type RoutedEdge = Edge<RoutedEdgeData>

function DiagramNode({ data, selected }: NodeProps<BusinessNodeData>) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const [fontSize, setFontSize] = useState(15)

  useLayoutEffect(() => {
    const node = nodeRef.current
    const label = labelRef.current
    if (!node || !label) return

    const measure = node.ownerDocument.createElement('span')
    const resize = () => {
      const width = label.clientWidth
      if (!width) return
      const nodeStyle = getComputedStyle(node)
      const labelStyle = getComputedStyle(label)
      const height = node.clientHeight - parseFloat(nodeStyle.paddingTop) - parseFloat(nodeStyle.paddingBottom)
      Object.assign(measure.style, {
        position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
        display: 'block', width: `${width}px`, maxWidth: 'none', height: 'auto',
        overflow: 'visible', whiteSpace: 'normal', overflowWrap: 'anywhere',
        fontFamily: labelStyle.fontFamily, fontWeight: labelStyle.fontWeight,
        letterSpacing: labelStyle.letterSpacing, lineHeight: '1.25',
      })
      measure.textContent = data.label
      node.appendChild(measure)
      let size = 15
      while (size > 10) {
        measure.style.fontSize = `${size}px`
        if (measure.scrollHeight <= Math.min(height, size * 1.25 * 2) + 1) break
        size--
      }
      measure.remove()
      setFontSize(size)
    }
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(node)
    return () => { observer?.disconnect(); measure.remove() }
  }, [data.label, data.shape])

  const vertical = data.direction === 'TB' || data.direction === 'BT'
  const reverse = data.direction === 'BT' || data.direction === 'RL'
  const source = vertical ? (reverse ? Position.Top : Position.Bottom) : (reverse ? Position.Left : Position.Right)
  const target = vertical ? (reverse ? Position.Bottom : Position.Top) : (reverse ? Position.Right : Position.Left)
  return <div ref={nodeRef} className={[css['bizgraph-node'], data.shape === 'round' && css['bizgraph-round'], data.shape === 'decision' && css['bizgraph-decision'], data.depth === 0 && css['bizgraph-root'], selected && css['bizgraph-selected']].filter(Boolean).join(' ')}>
    <Handle type="target" position={target} />
    <span ref={labelRef} style={{ fontSize }} title={data.label}>{data.label}</span>
    <Handle type="source" position={source} />
  </div>
}

function DiagramEdge({ id, data, label, style, markerEnd }: EdgeProps<RoutedEdgeData>) {
  if (!data?.points.length) return null
  return <BaseEdge id={id} path={roundedPath(data.points)} style={style} markerEnd={markerEnd} label={label} labelX={data.labelPosition?.x} labelY={data.labelPosition?.y} labelStyle={{ fill: 'var(--mybricks-text-color-secondary, #697386)', fontSize: 12 }} labelShowBg labelBgPadding={[4, 2]} />
}

const nodeTypes = { business: DiagramNode }
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
          void fitView({ padding: 0.15, maxZoom: 1 })
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

function DiagramContent({ content, interactive = false }: { content: string; interactive?: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const [direction, setDirection] = useState<'LR' | 'TB'>('TB')
  const graphs = useMemo(() => {
    try {
      const diagram = parseDiagram(content)
      const build = (direction: ParsedDiagram['direction']) => {
        const layout = createFlowLayout({ ...diagram, direction })
        const nodes: BusinessNode[] = layout.nodes.map(node => ({ id: node.id, type: 'business', position: node.position, data: { label: node.label, shape: node.shape, depth: node.depth ?? -1, direction }, draggable: false }))
        const edges: RoutedEdge[] = layout.edges.map((edge, index) => ({
          id: `edge-${index}`, source: edge.source, target: edge.target, type: 'routed', label: edge.label,
          data: { points: edge.points, labelPosition: edge.labelPosition },
          style: { stroke: 'var(--mybricks-text-color-secondary, #8a909d)', strokeWidth: 1.5, ...(edge.dashed ? { strokeDasharray: '5 4' } : {}) },
          ...(edge.arrow ? { markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--mybricks-text-color-secondary, #8a909d)' } } : {}),
        }))
        const width = Math.max(...layout.nodes.map(node => node.position.x + node.width)) - Math.min(...layout.nodes.map(node => node.position.x))
        const height = Math.max(...layout.nodes.map(node => node.position.y + node.height)) - Math.min(...layout.nodes.map(node => node.position.y))
        return { nodes, edges, width, height }
      }
      const primary = build(diagram.direction)
      return { primary, vertical: diagram.kind === 'mindmap' ? build('TB') : null }
    } catch {
      return null
    }
  }, [content])

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
  return <div ref={container} className={css['bizai-flow']} data-interactive={interactive}>
    <ReactFlow key={`${content}-${graphs.vertical ? direction : ''}`} nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={interactive} panOnDrag={interactive} panOnScroll={false} zoomOnScroll={interactive} zoomOnPinch={interactive} zoomOnDoubleClick={interactive} preventScrolling={interactive} disableKeyboardA11y={!interactive} minZoom={0.1} maxZoom={2} proOptions={{ hideAttribution: true }}>
      <Background />
      {!interactive && <FitOnResize container={container} />}
      {interactive && <Controls showInteractive={false} aria-label={copy.diagramControls()} />}
    </ReactFlow>
  </div>
}

export function Diagram({ content, interactive = false }: { content: string; interactive?: boolean }) {
  return <DiagramErrorBoundary key={content} content={content}><DiagramContent content={content} interactive={interactive} /></DiagramErrorBoundary>
}
