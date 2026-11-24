import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Handle, Position, PanOnScrollMode, type Edge, type Node, type NodeProps, type ReactFlowInstance } from 'reactflow'
import 'reactflow/dist/style.css'
import { attachShadowStyles } from '../../mix/understand-any/shadow-styles'
import YAML from 'yaml'
import { i18n } from './index.i18n'
import { getLazyCss } from '../../mix/lowcodeView/utils/css'
import * as lazyCss from './index.lazy.less'

const css = getLazyCss(lazyCss)
export type ChangeKind = 'function' | 'component' | 'page' | 'endpoint' | 'config' | 'data'
const KINDS: ChangeKind[] = ['function', 'component', 'page', 'endpoint', 'config', 'data']
type OverviewDef = { id: string; title: string; kind: ChangeKind; file?: string; symbol?: string; route?: string; desc?: string; parent?: string[] }
type ReviewSeverity = 'block' | 'critical' | 'suggest'
type ReviewAction = 'ai_fix' | 'prod_decide' | 'dev_collab'
type ReviewCheck = { title: string; severity: ReviewSeverity; desc: string; action?: ReviewAction; next?: string }
type OverviewNode = { id: string; ref: string; desc: string; tasks: string[]; type: ChangeKind; file?: string; route?: string; checks?: ReviewCheck[] }
type OverviewDocument = { root: { title: string }; defs: OverviewDef[]; changes: OverviewNode[] }
export type OverviewSelection = { kind: 'task'; id: string } | null
const severityLabel = (severity: ReviewSeverity) => ({ block: i18n.severityBlock, critical: i18n.severityCritical, suggest: i18n.severitySuggest })[severity]()
const actionLabel = (action: ReviewAction) => ({ ai_fix: i18n.reviewActionAiFix, prod_decide: i18n.reviewActionProduct, dev_collab: i18n.reviewActionDev })[action]()

class OverviewFormatError extends Error {}

function parseOverview(content: string): OverviewDocument {
  let doc: unknown
  try {
    doc = YAML.parse(content)
  } catch (error) {
    const details = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
    throw new OverviewFormatError(i18n.overviewErrorYaml(details))
  }
  const object = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
  const id = (v: unknown): v is string => typeof v === 'string' && Boolean(v.trim()) && v === v.trim() && v !== 'root'
  const fail = (message: string): never => { throw new OverviewFormatError(message) }
  const requireObject = (value: unknown, path: string): Record<string, any> => object(value) ? value : fail(i18n.overviewErrorObject(path))
  const requireText = (value: unknown, path: string) => { if (typeof value !== 'string' || !value.trim()) fail(i18n.overviewErrorText(path)) }
  const requireId = (value: unknown, path: string) => { if (!id(value)) fail(i18n.overviewErrorId(path)) }
  const checkKeys = (value: Record<string, any>, keys: string[], path: string) => {
    const unknown = Object.keys(value).find(key => !keys.includes(key))
    if (unknown) fail(i18n.overviewErrorUnknownField(`${path}.${unknown}`))
  }
  const rootDoc = requireObject(doc, 'overview.yaml')
  checkKeys(rootDoc, ['version', 'root', 'defs', 'changes'], 'overview.yaml')
  if (rootDoc.version !== 4) fail(i18n.overviewErrorEnum('version', '4'))
  const root = requireObject(rootDoc.root, 'root')
  checkKeys(root, ['title'], 'root')
  requireText(root.title, 'root.title')
  if (!Array.isArray(rootDoc.defs)) fail(i18n.overviewErrorArray('defs'))
  if (!Array.isArray(rootDoc.changes)) fail(i18n.overviewErrorArray('changes'))
  const defs = new Map<string, OverviewDef>()
  const defPaths = new Map<string, string>()
  for (const [index, value] of rootDoc.defs.entries()) {
    const path = `defs[${index}]`
    const def = requireObject(value, path)
    checkKeys(def, ['id', 'title', 'kind', 'file', 'symbol', 'route', 'desc', 'parent'], path)
    requireId(def.id, `${path}.id`)
    if (defs.has(def.id)) fail(i18n.overviewErrorDuplicate(`${path}.id`))
    requireText(def.title, `${path}.title`)
    if (!KINDS.includes(def.kind)) fail(i18n.overviewErrorEnum(`${path}.kind`, KINDS.join(' / ')))
    for (const field of ['file', 'symbol', 'route', 'desc']) {
      if (def[field] !== undefined && typeof def[field] !== 'string') fail(i18n.overviewErrorString(`${path}.${field}`))
    }
    const parents = def.parent === undefined ? [] : typeof def.parent === 'string' ? [def.parent] : def.parent
    if (!Array.isArray(parents)) fail(i18n.overviewErrorArray(`${path}.parent`))
    for (const [parentIndex, parent] of parents.entries()) requireId(parent, `${path}.parent[${parentIndex}]`)
    if (new Set(parents).size !== parents.length) fail(i18n.overviewErrorDuplicate(`${path}.parent`))
    defs.set(def.id, { ...def, id: def.id, title: def.title, kind: def.kind, parent: parents })
    defPaths.set(def.id, path)
  }
  for (const def of defs.values()) for (const [index, parent] of (def.parent ?? []).entries()) {
    const path = `${defPaths.get(def.id)}.parent[${index}]`
    if (!defs.has(parent)) fail(i18n.overviewErrorRef(path))
    if ((def.kind !== 'component' && def.kind !== 'data') || defs.get(parent)?.kind !== 'page') fail(i18n.overviewErrorParent(path))
  }
  const ids = new Set<string>()
  const changes: OverviewNode[] = rootDoc.changes.map((value: unknown, index: number) => {
    const path = `changes[${index}]`
    const entry = requireObject(value, path)
    checkKeys(entry, ['id', 'ref', 'desc', 'tasks', 'checks'], path)
    requireId(entry.id, `${path}.id`)
    if (ids.has(entry.id)) fail(i18n.overviewErrorDuplicate(`${path}.id`))
    ids.add(entry.id)
    requireText(entry.desc, `${path}.desc`)
    if (typeof entry.ref !== 'string' || !defs.has(entry.ref)) fail(i18n.overviewErrorRef(`${path}.ref`))
    if (!Array.isArray(entry.tasks)) fail(i18n.overviewErrorArray(`${path}.tasks`))
    for (const [taskIndex, task] of entry.tasks.entries()) requireId(task, `${path}.tasks[${taskIndex}]`)
    if (new Set(entry.tasks).size !== entry.tasks.length) fail(i18n.overviewErrorDuplicate(`${path}.tasks`))
    let checks: ReviewCheck[] | undefined
    if (entry.checks !== undefined) {
      if (!Array.isArray(entry.checks)) fail(i18n.overviewErrorArray(`${path}.checks`))
      checks = entry.checks.map((value: unknown, checkIndex: number) => {
        const checkPath = `${path}.checks[${checkIndex}]`
        const check = requireObject(value, checkPath)
        checkKeys(check, ['title', 'severity', 'desc', 'action', 'next'], checkPath)
        requireText(check.title, `${checkPath}.title`)
        if (!['block', 'critical', 'suggest'].includes(check.severity)) fail(i18n.overviewErrorEnum(`${checkPath}.severity`, 'block / critical / suggest'))
        requireText(check.desc, `${checkPath}.desc`)
        const actionAliases: Record<string, ReviewAction> = { ai_fix: 'ai_fix', prod_decide: 'prod_decide', dev_collab: 'dev_collab', product_decision: 'prod_decide', dev_collaboration: 'dev_collab' }
        if (check.action !== undefined && (typeof check.action !== 'string' || !Object.prototype.hasOwnProperty.call(actionAliases, check.action))) fail(i18n.overviewErrorEnum(`${checkPath}.action`, 'ai_fix / prod_decide / dev_collab'))
        if (check.next !== undefined) requireText(check.next, `${checkPath}.next`)
        return { title: check.title, severity: check.severity, desc: check.desc, action: check.action === undefined ? undefined : actionAliases[check.action], next: check.next }
      })
    }
    const def = defs.get(entry.ref)!
    return { id: entry.id, ref: entry.ref, desc: entry.desc, tasks: entry.tasks, type: def.kind, file: def.file, route: def.route, checks }
  })
  return { root: { title: root.title }, defs: [...defs.values()], changes }
}

export function readOverview(content: string | null) {
  if (!content?.trim()) return { doc: null as OverviewDocument | null, invalid: false, error: null as string | null }
  try { return { doc: parseOverview(content), invalid: false, error: null as string | null } }
  catch (error) { return { doc: null as OverviewDocument | null, invalid: true, error: error instanceof OverviewFormatError ? error.message : i18n.overviewErrorUnknown() } }
}
export function selectTaskChanges(doc: OverviewDocument, taskId: string, repoKey = '') {
  return doc.changes.filter(change => change.tasks.some(id => (repoKey ? `${repoKey}:${id}` : id) === taskId))
}
export type TaskChange = { id: string; node: { type: ChangeKind; title: string; file?: string; route?: string } }
export function collectTaskChanges(overviews: Array<{ key: string; label?: string; overview: ReturnType<typeof readOverview> }>): Map<string, TaskChange[]> {
  const result = new Map<string, TaskChange[]>()
  for (const { key, overview } of overviews) for (const change of overview.doc?.changes ?? []) for (const task of change.tasks) {
    const def = overview.doc!.defs.find(item => item.id === change.ref)
    if (!def) continue
    const uid = key ? `${key}:${task}` : task
    const list = result.get(uid) ?? []
    const relatedId = JSON.stringify([key, def.id])
    if (!list.some(item => item.id === relatedId)) {
      list.push({ id: relatedId, node: { type: def.kind, title: def.title, file: def.file, route: def.route } })
    }
    result.set(uid, list)
  }
  return result
}
export type TaskReviewCounts = { total: number; reviewed: number; block: number; critical: number; suggest: number }
export function getTaskReviewState(counts?: TaskReviewCounts): 'passed' | 'failed' | 'pending' {
  if (counts && (counts.block > 0 || counts.critical > 0)) return 'failed'
  if (counts && counts.total > 0 && counts.reviewed === counts.total) return 'passed'
  return 'pending'
}
export function TaskReviewMeta({ counts }: { counts?: TaskReviewCounts }) {
  const state = getTaskReviewState(counts)
  const label = state === 'passed' ? i18n.taskReviewPassed() : i18n.taskReviewPending()
  const pendingCount = (counts?.block ?? 0) + (counts?.critical ?? 0)
  return <span className={css['task-review-meta']}>{state === 'failed' ? <span className={css['task-review-count']}>{i18n.taskReviewPendingCount(pendingCount)}</span> : <span className={css['task-review-status']} data-state={state}><span className={css['task-review-dot']} aria-hidden="true" />{label}</span>}</span>
}
export function collectTaskReviewCounts(overviews: Array<{ key: string; overview: ReturnType<typeof readOverview> }>): Map<string, TaskReviewCounts> {
  const result = new Map<string, TaskReviewCounts>()
  for (const { key, overview } of overviews) for (const change of overview.doc?.changes ?? []) for (const task of change.tasks) {
    const uid = key ? `${key}:${task}` : task
    const counts = result.get(uid) ?? { total: 0, reviewed: 0, block: 0, critical: 0, suggest: 0 }
    counts.total++
    if (change.checks !== undefined) counts.reviewed++
    for (const check of change.checks ?? []) {
      counts[check.severity]++
    }
    result.set(uid, counts)
  }
  return result
}
function getNodeKind(node: { type: ChangeKind | 'root' }) {
  switch (node.type) {
    case 'page': return i18n.overviewPage()
    case 'component': return i18n.overviewComponent()
    case 'data': return i18n.overviewData()
    case 'endpoint': return i18n.overviewEndpoint()
    case 'function': return i18n.overviewFunction()
    case 'config': return i18n.overviewConfig()
    default: return i18n.overviewGlobal()
  }
}
export function ImpactTag({ node, title }: { node: { type: ChangeKind; title: string; file?: string; route?: string }; title?: string }) {
  return <span className={css['impact-tag']} title={title ?? (node.file || node.route || node.title)}><NodeIcon kind={node.type} /><span>{getNodeKind(node)}</span><strong>{node.title}</strong></span>
}
function NodeIcon({ kind }: { kind: ChangeKind | 'root' }) {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'root' && <><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="12" y="3" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><rect x="12" y="12" width="5" height="5" rx="1" /></>}
      {kind === 'page' && <><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M3 7.5h14M6 11h5M6 13.5h8" /></>}
      {kind === 'component' && <><path d="M10 2.8 17 6.5v7L10 17.2l-7-3.7v-7L10 2.8Z" /><path d="m3.5 6.8 6.5 3.5 6.5-3.5M10 10.3v6.5" /></>}
      {kind === 'endpoint' && <><circle cx="5" cy="15" r="1.7" /><circle cx="15" cy="5" r="1.7" /><path d="M5 13.3V9.5A3.5 3.5 0 0 1 8.5 6h5" /></>}
      {kind === 'function' && <><path d="M7.5 3.5C5.5 3.5 6 6.5 4 8c2 1.5 1.5 4.5 3.5 4.5M12.5 3.5c2 0 1.5 3 3.5 4.5-2 1.5-1.5 4.5-3.5 4.5" /></>}
      {kind === 'config' && <><path d="M3 6h14M3 14h14" /><circle cx="7" cy="6" r="2" /><circle cx="13" cy="14" r="2" /></>}
      {kind === 'data' && <><ellipse cx="10" cy="5" rx="6" ry="2.4" /><path d="M4 5v10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V5" /><path d="M4 10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4" /></>}
    </svg>
  )
}


type ChangeRowData = { change: OverviewNode; def: OverviewDef; parents: OverviewDef[]; taskId: string; onFixReview: (message: string) => void; isVibing: boolean }
function ChangeNode({ data }: NodeProps<ChangeRowData>) {
  const { change, def, parents } = data
  return <article className={css['change-view-card']}>
    <div className={css['change-description']}><span className={css['change-description-label']}>{i18n.changeDescription()}</span><p>{change.desc}</p></div>
    <div className={css['change-paths']}>
      {(parents.length ? parents : [null]).map(parent => {
        const path = parent ? `${parent.title} / ${def.title}` : def.title
        return <div className={css['change-path']} key={parent?.id ?? def.id} title={path} aria-label={path}>
          {parent && <><span className={css['change-path-item']}><NodeIcon kind={parent.kind} /><span className={css['change-path-text']}>{parent.title}</span></span><svg className={css['change-path-separator']} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4.5 3 3 3-3 3" /></svg></>}
          <span className={`${css['change-path-item']} ${css['change-path-current']}`}><NodeIcon kind={def.kind} /><span className={css['change-path-text']}>{def.title}</span></span>
        </div>
      })}
    </div>
    <Handle type="source" position={Position.Right} />
  </article>
}
function ReviewNode({ data }: NodeProps<ChangeRowData>) {
  const checks = data.change.checks
  return <article className={`${css['change-view-analysis']} nodrag nopan`}>
    <Handle type="target" position={Position.Left} />
    {checks !== undefined && <div className={css['review-results']}>
        {checks.map((check, index) => <div className={css['audit-item']} data-severity={check.severity} key={index}><div className={css['audit-heading']}><span className={css['audit-status']}>{severityLabel(check.severity)}</span><strong>{check.title}</strong></div><div className={css['audit-description']}>{check.desc}</div>{check.action && <div className={css['audit-next']}><span className={css['audit-next-label']}>{i18n.reviewNextStep()}</span>{check.action === 'ai_fix' ? <button type="button" className={`${css['audit-action']} ${css['audit-action-button']} nodrag nopan`} disabled={data.isVibing} title={i18n.reviewAiFixLabel()} aria-label={i18n.reviewAiFixLabel()} onClick={() => data.onFixReview(i18n.reviewAiFixMessage(data.taskId, data.change.id, check.title))}>{actionLabel(check.action)}<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 6h7M6.5 3l3 3-3 3" /></svg></button> : <span className={css['audit-action']}>{actionLabel(check.action)}</span>}{check.action === 'prod_decide' && check.next && <span>{check.next}</span>}</div>}</div>)}
      </div>}
  </article>
}
const nodeTypes = { change: ChangeNode, review: ReviewNode }
const COLUMN_GAP = 40
const ROW_GAP = 16

export default function TaskOverview({ overviews, selection, onFixReview, isVibing = false }: {
  overviews: Array<{ key: string; label?: string; overview: ReturnType<typeof readOverview> }>
  selection: OverviewSelection
  onFixReview: (message: string) => void
  isVibing?: boolean
}) {
  useLayoutEffect(() => attachShadowStyles(document), [])
  const canvasRef = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [zoom, setZoom] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null)
  const [positioned, setPositioned] = useState(false)
  const entries = useMemo(() => selection ? overviews.flatMap(({ key, overview }) => overview.doc ? selectTaskChanges(overview.doc, selection.id, key).map(change => ({ change, key, defs: overview.doc!.defs })) : []) : [], [overviews, selection?.id])
  const availableWidth = Math.max(0, canvasSize.width - 24)
  const changeWidth = canvasSize.width ? Math.min(300, Math.max(200, Math.floor((availableWidth - COLUMN_GAP) * 0.44))) : 300
  const reviewWidth = canvasSize.width ? Math.min(340, Math.max(220, availableWidth - COLUMN_GAP - changeWidth)) : 340
  const graph = useMemo(() => {
    let y = 12
    const nodes: Node[] = []
    const edges: Edge[] = []
    for (const { change, key, defs } of entries) {
      const changeId = JSON.stringify([key, change.id, 'change'])
      const reviewId = JSON.stringify([key, change.id, 'review'])
      const def = defs.find(item => item.id === change.ref)!
      const parents = (def.parent ?? []).map(id => defs.find(item => item.id === id)!).filter(Boolean)
      const data = { change, def, parents, taskId: selection?.id ?? '', onFixReview, isVibing }
      const changeHeight = heights[changeId] ?? 120
      const reviewHeight = change.checks?.length ? heights[reviewId] ?? 120 : 0
      const rowHeight = Math.max(changeHeight, reviewHeight)
      nodes.push({ id: changeId, type: 'change', position: { x: 12, y: y + (rowHeight - changeHeight) / 2 }, draggable: false, selectable: false, style: { width: changeWidth }, data })
      if (change.checks?.length) {
        nodes.push({ id: reviewId, type: 'review', position: { x: 12 + changeWidth + COLUMN_GAP, y: y + (rowHeight - reviewHeight) / 2 }, draggable: false, selectable: false, style: { width: reviewWidth, pointerEvents: 'all', cursor: 'default' }, data })
        const hasRisk = change.checks.some(check => check.severity === 'block' || check.severity === 'critical')
        edges.push({ id: JSON.stringify([key, change.id, 'edge']), source: changeId, target: reviewId, type: 'straight', className: `${css['review-edge']} ${hasRisk ? css['review-edge-risk'] : ''}` })
      }
      y += rowHeight + ROW_GAP
    }
    const width = 24 + changeWidth + (edges.length ? COLUMN_GAP + reviewWidth : 0)
    return { nodes, edges, width, height: y }
  }, [entries, heights, changeWidth, reviewWidth, selection?.id, onFixReview, isVibing])
  const translateExtent = useMemo<[[number, number], [number, number]]>(() => [
    [0, 0],
    [Math.max(graph.width, canvasSize.width / zoom), Math.max(graph.height, canvasSize.height / zoom)],
  ], [graph.width, graph.height, canvasSize, zoom])
  const layoutReady = graph.nodes.every(node => heights[node.id] !== undefined)
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : undefined
    const measure = () => {
      const next: Record<string, number> = {}
      canvas.querySelectorAll<HTMLElement>('.react-flow__node-change, .react-flow__node-review').forEach(element => {
        observer?.observe(element)
        const id = element.dataset.id
        const height = element.getBoundingClientRect().height / zoom
        if (id && height > 0) next[id] = Math.ceil(height)
      })
      setHeights(current => Object.keys(next).length === Object.keys(current).length && Object.keys(next).every(id => current[id] === next[id]) ? current : next)
    }
    measure()
    const mutations = typeof MutationObserver !== 'undefined' ? new MutationObserver(measure) : undefined
    mutations?.observe(canvas, { childList: true, subtree: true })
    return () => { observer?.disconnect(); mutations?.disconnect() }
  }, [graph.nodes, zoom])
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const update = () => {
      const { clientWidth: width, clientHeight: height } = canvas
      setCanvasSize(current => current.width === width && current.height === height ? current : { width, height })
    }
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined
    observer?.observe(canvas)
    return () => observer?.disconnect()
  }, [entries.length])
  useLayoutEffect(() => {
    if (!flow || !layoutReady || !canvasSize.width || !canvasSize.height || positioned) return
    const frame = requestAnimationFrame(() => {
      flow.setViewport({ x: 0, y: 0, zoom: 1 })
      setPositioned(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [flow, layoutReady, canvasSize, positioned])
  const invalid = overviews.some(({ overview }) => overview.invalid)
  const errorDetails = overviews.flatMap(({ overview }) => overview.invalid && overview.error ? [overview.error] : []).join('\n') || i18n.overviewErrorUnknown()
  return <section className={css['overview-body']} aria-label={i18n.overviewView()}>
    {invalid ? <div className={css['overview-empty']} role="status"><span>{i18n.overviewInvalid()} <button type="button" className={css['overview-fix-link']} disabled={isVibing} onClick={() => onFixReview(i18n.overviewFixMessage(errorDetails))}>{i18n.overviewFixAction()}</button></span></div> : !selection ? <div className={css['overview-placeholder']}><strong>{i18n.selectTaskChanges()}</strong><span>{i18n.selectTaskChangesHint()}</span></div> :
      <div className={css['change-view']}>
        {!entries.length ? <div className={css['overview-empty']} role="status"><span>{i18n.noTaskChanges()} <button type="button" className={css['overview-fix-link']} disabled={isVibing} onClick={() => onFixReview(i18n.addTaskChangesMessage(selection.id))}>{i18n.addTaskChangesAction()}</button></span></div> :
          <div className={css['overview-canvas']} ref={canvasRef} data-layout-ready={layoutReady && positioned}>
            <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
              onInit={setFlow}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }} panOnDrag={false} panOnScroll panOnScrollMode={PanOnScrollMode.Free}
              zoomOnScroll={false} zoomOnDoubleClick={false} translateExtent={translateExtent} onMove={(_, viewport) => setZoom(viewport.zoom)} minZoom={0.2} maxZoom={2} proOptions={{ hideAttribution: true }} />
          </div>}
      </div>}
  </section>
}
