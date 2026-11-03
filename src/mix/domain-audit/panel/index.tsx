import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { parse } from 'yaml'
import context from '../../context'
import { getLazyCss } from '../../lowcodeView/utils/css'
import * as lazyCss from './index.lazy.less'
import { copy } from './index.i18n'
import { layoutDomainGraph, layoutLayeredOverview, layoutMindMap } from './layout'
import { flowDefinition, pageViewData, pageAssociations, type DomainDocument, type DomainNode } from './model'

const css = getLazyCss(lazyCss)

function parseDocument(content: string): DomainDocument {
  const doc = parse(content) as DomainDocument
  if (doc?.version !== 1 || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges) || doc.nodes.some(n => !n || typeof n.id !== 'string' || typeof n.title !== 'string' || typeof n.type !== 'string' || !n.type.trim() || (n.details !== undefined && typeof n.details !== 'string' && !(Array.isArray(n.details) && n.details.every(item => typeof item === 'string')))) || doc.edges.some(e => !e || typeof e.from !== 'string' || typeof e.to !== 'string' || typeof e.type !== 'string') || (doc.overview !== undefined && (!doc.overview || typeof doc.overview !== 'object' || Array.isArray(doc.overview))) || (doc.flows !== undefined && (!Array.isArray(doc.flows) || doc.flows.some(flow => !flow || typeof flow.id !== 'string' || !Array.isArray(flow.steps) || !Array.isArray(flow.transitions) || flow.steps.some(step => !step || typeof step.id !== 'string' || typeof step.title !== 'string') || flow.transitions.some(edge => !edge || typeof edge.from !== 'string' || typeof edge.to !== 'string'))))) throw new Error(copy.invalid())
  if (new Set(doc.nodes.map(node => node.id)).size !== doc.nodes.length || ['featuredNodes', 'featuredFlows', 'highlights'].some(key => { const value = (doc.overview as any)?.[key]; return value !== undefined && (!Array.isArray(value) || value.some(item => typeof item !== 'string')) })) throw new Error(copy.invalid())
  const optionalStrings = (value: any, keys: string[]) => keys.every(key => value[key] === undefined || typeof value[key] === 'string')
  if ((doc.overview && !optionalStrings(doc.overview, ['title', 'summary'])) || doc.nodes.some(node => !optionalStrings(node, ['summary', 'route', 'status']) || (node.evidence !== undefined && (!Array.isArray(node.evidence) || node.evidence.some(evidence => !evidence || typeof evidence.file !== 'string')))) || doc.edges.some(edge => !optionalStrings(edge, ['title', 'description', 'condition'])) || doc.flows?.some(flow => flow.steps.some(step => !optionalStrings(step, ['node', 'description'])) || flow.transitions.some(edge => !optionalStrings(edge, ['title', 'description'])))) throw new Error(copy.invalid())
  return doc
}

type GraphNode = { id: string; title: string; summary?: string; type: string }
type GraphEdge = { from: string; to: string; type: string; title?: string; description?: string; condition?: string }
function Graph({ nodes, edges, selected, selectedEdge, overview, mindMap, rootTitle, onNode, onEdge }: { nodes: GraphNode[]; edges: GraphEdge[]; selected: string | null; selectedEdge: number | null; overview: boolean; mindMap: boolean; rootTitle: string; onNode: (id: string) => void; onEdge: (index: number) => void }) {
  const layout = useMemo(() => overview && mindMap ? { ...layoutMindMap(nodes, edges), bands: [] } : overview ? { ...layoutLayeredOverview(nodes, edges), rootPosition: null, rootPaths: [] } : { ...layoutDomainGraph(nodes, edges), bands: [], rootPosition: null, rootPaths: [] }, [nodes, edges, overview, mindMap])
  const { positions, paths, width, height, bands, rootPosition, rootPaths } = layout
  const categoryLabels: Record<string, string> = { domain: copy.domain(), module: copy.module(), page: copy.page(), flow: copy.flow(), other: copy.other() }
  const connected = useMemo(() => {
    if (!selected) return null
    const ids = new Set([selected])
    edges.forEach(edge => { if (edge.from === selected) ids.add(edge.to); if (edge.to === selected) ids.add(edge.from) })
    return ids
  }, [edges, selected])
  if (!nodes.length) return <div className={css['domain-graph-empty']}>{copy.noMap()}</div>
  return <div className={css['domain-canvas']} tabIndex={0} role="region" aria-label={copy.map()}><svg width={width + 120} height={height + 96} role="group" aria-label={copy.map()}>
    <defs><marker id="domain-panel-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" className={css['domain-edge-arrow']} /></marker></defs>
    <g transform="translate(60 48)">
    {bands.map(band => <g key={band.type}><rect x="0" y={band.y} width={width} height="112" rx="10" className={css['domain-layer-band']} /><text x="20" y={band.y + 49} className={css['domain-layer-title']}>{categoryLabels[band.type]}</text><text x="20" y={band.y + 70} className={css['domain-layer-count']}>{band.count}</text></g>)}
    {rootPaths.map((route, i) => <path key={i} d={route.path} fill="none" className={css['domain-mind-root-line']} />)}
    {rootPosition && <g><rect x={rootPosition.x} y={rootPosition.y} width="190" height="56" rx="8" className={css['domain-mind-root']} /><text x={rootPosition.x + 95} y={rootPosition.y + 33} textAnchor="middle" className={css['domain-mind-root-title']}><title>{rootTitle}</title>{rootTitle.length > 13 ? `${rootTitle.slice(0, 13)}…` : rootTitle}</text></g>}
    {edges.map((edge, i) => {
      const route = paths[i]
      if (!route) return null
      const highlighted = selectedEdge === i || !!selected && (edge.from === selected || edge.to === selected)
      return <g key={i} role="button" tabIndex={0} aria-label={edge.title || edge.type} onClick={() => onEdge(i)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdge(i) } }} opacity={selected && !highlighted ? 0.2 : 1} className={`${css['domain-edge']} ${highlighted ? css['domain-edge-highlighted'] : ''}`}>
        <title>{edge.title || edge.type}</title><path d={route.path} fill="none" stroke="transparent" strokeWidth="14" /><path d={route.path} fill="none" className={css['domain-edge-line']} strokeWidth={1.5} markerEnd="url(#domain-panel-arrow)" />
        {edge.title && <text x={route.label.x} y={route.label.y - 5} textAnchor="middle" className={css['domain-edge-label']}>{edge.title.length > 12 ? `${edge.title.slice(0, 12)}…` : edge.title}</text>}
      </g>
    })}
    {nodes.map(node => { const pos = positions.get(node.id); if (!pos) return null; const kind = ['domain', 'module', 'page', 'flow', 'step'].includes(node.type) ? node.type : 'other'; return <g key={node.id} role="button" tabIndex={0} aria-label={node.title} onClick={() => onNode(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNode(node.id) } }} opacity={connected && !connected.has(node.id) ? 0.28 : 1} className={css['domain-node']}>
      <title>{node.title}</title><rect x={pos.x} y={pos.y} width="190" height="56" rx="8" className={`${css['domain-node-box']} ${selected === node.id ? css['domain-node-selected'] : ''}`} /><circle cx={pos.x + 15} cy={pos.y + 17} r="4" className={css[`domain-dot-${kind}`]} /><text x={pos.x + 26} y={pos.y + 21} className={css['domain-node-title']}>{node.title.length > 13 ? `${node.title.slice(0, 13)}…` : node.title}</text>{node.summary && <text x={pos.x + 14} y={pos.y + 42} className={css['domain-node-status']}>{node.summary.length > 18 ? `${node.summary.slice(0, 18)}…` : node.summary}</text>}{overview && node.type === 'flow' && <text x={pos.x + 174} y={pos.y + 36} className={css['domain-flow-arrow']}>›</text>}
    </g> })}
    </g>
  </svg></div>
}

export default function DomainPanel({ content }: { content?: string }) {
  const [doc, setDoc] = useState<DomainDocument | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedStep, setSelectedStep] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null)
  const [flowId, setFlowId] = useState<string | null>(null)
  const [pageView, setPageView] = useState(false)
  const [mindMap, setMindMap] = useState(false)
  const [state, setState] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const reset = () => { setSelected(null); setSelectedStep(null); setSelectedEdge(null); setFlowId(null); setPageView(false) }
  const load = useCallback(async () => {
    setState('loading'); setPreview(false)
    try {
      if (!content) { setDoc(null); setState('empty'); return }
      setDoc(parseDocument(content)); reset(); setState('ready')
    } catch (err) { setError(err instanceof Error ? err.message : copy.readFailed()); setState('error') }
  }, [content])
  useEffect(() => { void load() }, [load])
  const generate = () => (window as any)._sandbox_?.helpers?.sendToAgent?.(context.comId, { message: copy.generatePrompt(), aiRole: 'fast' })
  const showPreview = () => {
    const sample: DomainDocument = { version: 1, overview: { title: copy.exampleSystem(), summary: copy.exampleDescription(), featuredNodes: ['domain:order', 'domain:payment'], featuredFlows: ['flow:create'] }, nodes: [
      { id: 'domain:order', type: 'domain', title: copy.exampleOrder(), summary: copy.exampleDescription() },
      { id: 'domain:payment', type: 'domain', title: copy.examplePayment(), summary: copy.exampleDescription() },
      { id: 'module:order-create', type: 'module', title: copy.exampleModule(), summary: copy.exampleDescription() },
      { id: 'page:checkout', type: 'page', title: copy.examplePage(), summary: copy.exampleDescription() },
      { id: 'page:orders', type: 'page', title: copy.exampleListPage(), summary: copy.exampleDescription() },
      { id: 'flow:create', type: 'flow', title: copy.exampleFlow(), summary: copy.exampleDescription() },
    ], edges: [
      { from: 'domain:order', to: 'module:order-create', type: 'contains' },
      { from: 'module:order-create', to: 'page:checkout', type: 'uses_page' },
      { from: 'page:orders', to: 'page:checkout', type: 'navigates', title: copy.exampleNavigate() },
      { from: 'module:order-create', to: 'flow:create', type: 'supports' },
      { from: 'domain:order', to: 'domain:payment', type: 'cross_domain', title: copy.exampleRelation() },
    ], flows: [{ id: 'flow:create', steps: [{ id: 'fill', title: copy.examplePage(), node: 'page:checkout' }, { id: 'submit', title: copy.exampleStep(), node: 'module:order-create' }], transitions: [{ from: 'fill', to: 'submit' }] }] }
    setDoc(sample); reset(); setPreview(true); setState('ready')
  }
  const nodes = doc?.nodes ?? []
  const active = nodes.find(node => node.id === selected)
  const activeFlow = doc && flowId ? flowDefinition(doc, flowId) : null
  const flowNode = nodes.find(node => node.id === flowId)
  const step = activeFlow?.steps.find(item => item.id === selectedStep)
  const stepNode = step?.node ? nodes.find(node => node.id === step.node) : undefined
  const pageData = useMemo(() => doc ? pageViewData(doc) : { pages: [], navigation: [] }, [doc])
  const graphNodes: GraphNode[] = useMemo(() => flowId
    ? (activeFlow?.steps ?? []).map(item => ({ ...item, summary: item.description, type: 'step' }))
    : pageView ? pageData.pages : (doc?.nodes ?? []).filter(node => node.type !== 'step'), [flowId, activeFlow, pageView, pageData, doc])
  const graphEdges: GraphEdge[] = useMemo(() => {
    if (flowId) return (activeFlow?.transitions ?? []).map(edge => ({ ...edge, type: 'next' }))
    if (pageView) return pageData.navigation
    const ids = new Set(graphNodes.map(node => node.id))
    return (doc?.edges ?? []).filter(edge => ids.has(edge.from) && ids.has(edge.to))
  }, [flowId, activeFlow, graphNodes, doc, pageView, pageData])
  const graphSelection = flowId ? selectedStep : selected
  const activeEdge = selectedEdge === null ? null : graphEdges[selectedEdge]
  const titleOf = (id: string) => graphNodes.find(node => node.id === id)?.title ?? nodes.find(node => node.id === id)?.title ?? id
  const types = [ { type: 'domain', title: copy.domain() }, { type: 'module', title: copy.module() }, { type: 'page', title: copy.page() }, { type: 'flow', title: copy.flow() }, { type: 'step', title: copy.step() } ]
  const typeLabel = (node: DomainNode) => types.find(item => item.type === node.type)?.title ?? node.type
  const statusLabel = (status?: string) => status === 'confirmed' ? copy.confirmed() : status === 'inferred' ? copy.inferred() : copy.unknown()
  const showOverview = (id?: string) => { setPageView(false); setFlowId(null); setSelected(id ?? null); setSelectedStep(null); setSelectedEdge(null) }
  const showPages = (id?: string) => { setPageView(true); setFlowId(null); setSelected(id ?? null); setSelectedStep(null); setSelectedEdge(null) }
  const returnFromFlow = () => { setFlowId(null); if (!pageView) setSelected(null); setSelectedStep(null); setSelectedEdge(null) }
  const openFlow = (id: string) => { setFlowId(id); if (!pageView) setSelected(null); setSelectedStep(null); setSelectedEdge(null) }
  const renderDetails = (node: DomainNode) => <><h3>{node.title}</h3>{node.status && <div className={css['domain-status']}>{statusLabel(node.status)}</div>}<p>{copy.type()}: {typeLabel(node)}</p>{node.summary && <p>{node.summary}</p>}{node.details && <><h4>{copy.information()}</h4>{Array.isArray(node.details) ? <ul>{node.details.map((detail, i) => <li key={i}>{detail}</li>)}</ul> : <p>{node.details}</p>}</>}{node.route && <><h4>{copy.route()}</h4><div className={css['domain-evidence']}>{node.route}</div></>}{Boolean(node.evidence?.length) && <><h4>{copy.evidence()}</h4>{node.evidence?.map((e, i) => <div className={css['domain-evidence']} key={i}>{e.file}{e.line ? `:${e.line}` : ''}{e.symbol ? ` · ${e.symbol}` : ''}</div>)}</>}<h4>{copy.relations()}</h4>{doc?.edges.filter(e => e.from === node.id || e.to === node.id).length ? doc.edges.filter(e => e.from === node.id || e.to === node.id).map((edge, i) => <div className={css['domain-relation']} key={i}>{nodes.find(n => n.id === edge.from)?.title ?? edge.from} → {nodes.find(n => n.id === edge.to)?.title ?? edge.to}<small>{edge.title || edge.type}{edge.condition ? ` · ${edge.condition}` : ''}{edge.description ? ` · ${edge.description}` : ''}</small></div>) : <span className={css['domain-muted']}>{copy.noRelations()}</span>}</>
  const renderPageDetails = (node: DomainNode) => {
    if (!doc) return null
    const incoming = pageData.navigation.filter(edge => edge.to === node.id)
    const outgoing = pageData.navigation.filter(edge => edge.from === node.id)
    const associations = pageAssociations(doc, node.id)
    const showNavigation = (edges: typeof incoming, direction: 'from' | 'to', empty: string) => edges.length ? edges.map((edge, index) => { const target = nodes.find(item => item.id === edge[direction]); return target ? <div className={css['domain-page-item']} key={index}><button type="button" onClick={() => showPages(target.id)}>{target.title}</button>{edge.title && <small>{edge.title}</small>}</div> : null }) : <span className={css['domain-muted']}>{empty}</span>
    const showAssociated = (item: DomainNode) => item.type === 'flow' ? openFlow(item.id) : item.type === 'page' ? showPages(item.id) : showOverview(item.id)
    return <><h3>{node.title}</h3>{node.summary && <p>{node.summary}</p>}{node.route && <div className={css['domain-evidence']}>{node.route}</div>}<h4>{copy.incoming()}</h4>{showNavigation(incoming, 'from', copy.noIncoming())}<h4>{copy.outgoing()}</h4>{showNavigation(outgoing, 'to', copy.noOutgoing())}<h4>{copy.associated()}</h4>{associations.direct.length || associations.flows.length ? <>{associations.direct.map((item, index) => <div className={css['domain-page-item']} key={`edge-${index}`}><button type="button" onClick={() => showAssociated(item.node)}>{item.node.title}</button><small>{typeLabel(item.node)} · {item.edge.title || item.edge.type}</small></div>)}{associations.flows.map(item => <div className={css['domain-page-item']} key={item.id}><button type="button" onClick={() => openFlow(item.id)}>{item.title}</button><small>{copy.flow()}</small></div>)}</> : <span className={css['domain-muted']}>{copy.noAssociated()}</span>}</>
  }
  return <div className={css['domain-panel']} data-zone-type="ai-request">
    <div className={css['domain-header']}><span>{preview ? copy.previewLabel() : copy.subtitle()}</span><button type="button" onClick={() => void load()}>{copy.refresh()}</button></div>
    {state === 'loading' && <div className={css['domain-empty']}>{copy.loading()}</div>}
    {state === 'empty' && <div className={css['domain-empty']}><div className={css['domain-empty-icon']}>◇</div><strong>{copy.emptyTitle()}</strong><p>{copy.emptyDescription()}</p><div className={css['domain-empty-actions']}><button type="button" onClick={generate}>{copy.generate()}</button><button type="button" onClick={showPreview}>{copy.preview()}</button></div></div>}
    {state === 'error' && <div className={css['domain-empty']} role="alert"><strong>{error}</strong><button type="button" onClick={() => void load()}>{copy.refresh()}</button></div>}
    {state === 'ready' && doc && <>
      <div className={css['domain-view-heading']}>
        {flowId ? <><button type="button" onClick={returnFromFlow} className={css['domain-back']}>← {pageView ? copy.pagesView() : copy.overview()}</button><strong>{flowNode?.title ?? flowId}</strong><span>{flowNode?.summary}</span></> : <><div className={css['domain-view-tabs']}><button type="button" aria-pressed={!pageView} onClick={() => showOverview()}>{copy.overview()}</button><button type="button" aria-pressed={pageView} onClick={() => showPages()}>{copy.pagesView()}</button></div>{!pageView && doc.overview?.title && <strong>{doc.overview.title}</strong>}<span>{pageView ? (pageData.pages.length && !pageData.navigation.length ? copy.noNavigation() : '') : (doc.overview?.summary || '')}</span></>}
      </div>
      {!flowId && !pageView && <div className={css['domain-layout-switch']} role="group" aria-label={copy.layout()}><button type="button" aria-pressed={!mindMap} onClick={() => setMindMap(false)}>{copy.layered()}</button><button type="button" aria-pressed={mindMap} onClick={() => setMindMap(true)}>{copy.mindMap()}</button></div>}
      <div className={css['domain-content']}>
        {flowId && !graphNodes.length ? <div className={css['domain-graph-empty']}>{copy.noFlowSteps()}</div> : pageView && !flowId && !graphNodes.length ? <div className={css['domain-graph-empty']}>{copy.noPages()}</div> : <Graph nodes={graphNodes} edges={graphEdges} selected={graphSelection} selectedEdge={selectedEdge} overview={!flowId && !pageView} mindMap={mindMap} rootTitle={doc.overview?.title || copy.overview()} onNode={id => { setSelectedEdge(null); if (flowId) setSelectedStep(id); else if (nodes.find(node => node.id === id)?.type === 'flow') openFlow(id); else setSelected(id) }} onEdge={index => { setSelectedEdge(index); setSelected(null); setSelectedStep(null) }} />}
        <aside className={css['domain-details']}><div className={css['domain-details-label']}>{activeEdge ? copy.edgeDetail() : copy.detail()}</div>
          {activeEdge ? <><h3>{activeEdge.title || activeEdge.type}</h3><p>{titleOf(activeEdge.from)} → {titleOf(activeEdge.to)}</p>{activeEdge.description && <p>{activeEdge.description}</p>}{activeEdge.condition && <p>{activeEdge.condition}</p>}</> : flowId ? step ? <><h3>{step.title}</h3>{step.description && <p>{step.description}</p>}{stepNode && <><h4>{copy.openNode()}</h4><button className={css['domain-action']} onClick={() => pageView && stepNode.type === 'page' ? showPages(stepNode.id) : showOverview(stepNode.id)}>{stepNode.title} →</button></>}</> : flowNode ? renderDetails(flowNode) : <p>{copy.select()}</p> : active ? pageView ? renderPageDetails(active) : renderDetails(active) : <p>{copy.select()}</p>}
          <details className={css['domain-diagnostics']}><summary>{copy.diagnostics()}</summary><pre>{JSON.stringify({ scope: doc.scope, diagnostics: doc.diagnostics }, null, 2)}</pre></details>
        </aside>
      </div>
    </>}
  </div>
}
