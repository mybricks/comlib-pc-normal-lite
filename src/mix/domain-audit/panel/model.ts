export type Evidence = { file: string; symbol?: string; line?: number }
export type DomainNode = { id: string; type: string; title: string; route?: string; summary?: string; details?: string | string[]; status?: string; evidence?: Evidence[] }
export type DomainEdge = { from: string; to: string; type: string; title?: string; description?: string; condition?: string; status?: string; evidence?: Evidence[] }
export type FlowStep = { id: string; title: string; node?: string; description?: string }
export type FlowTransition = { from: string; to: string; title?: string; description?: string }
export type DomainFlow = { id: string; steps: FlowStep[]; transitions: FlowTransition[] }
export type DomainDocument = { version: number; nodes: DomainNode[]; edges: DomainEdge[]; overview?: { title?: string; summary?: string; highlights?: string[]; featuredNodes?: string[]; featuredFlows?: string[] }; flows?: DomainFlow[]; scope?: unknown; diagnostics?: unknown }

export function overviewNodes(doc: DomainDocument): DomainNode[] {
  const featured = new Set(doc.overview?.featuredNodes ?? [])
  return [...doc.nodes.filter(node => featured.has(node.id)), ...doc.nodes.filter(node => !featured.has(node.id))]
}

export function visibleNodes(doc: DomainDocument, focus: string | null): DomainNode[] {
  if (!focus) return overviewNodes(doc)
  const ids = new Set([focus])
  doc.edges.forEach(edge => {
    if (edge.from === focus) ids.add(edge.to)
    if (edge.to === focus) ids.add(edge.from)
  })
  return doc.nodes.filter(node => ids.has(node.id))
}

export function flowDefinition(doc: DomainDocument, id: string): DomainFlow | null {
  const explicit = doc.flows?.find(flow => flow.id === id)
  if (explicit) return explicit
  const stepIds = new Set(doc.edges.filter(edge => edge.from === id && edge.type === 'contains').map(edge => edge.to))
  const steps = doc.nodes.filter(node => node.type === 'step' && stepIds.has(node.id)).map(node => ({ id: node.id, title: node.title, node: node.id, description: node.summary }))
  if (!steps.length) return null
  const ids = new Set(steps.map(step => step.id))
  const transitions = doc.edges.filter(edge => edge.type === 'next' && ids.has(edge.from) && ids.has(edge.to)).map(edge => ({ from: edge.from, to: edge.to, title: edge.title, description: edge.description }))
  return { id, steps, transitions }
}

export function featuredFlows(doc: DomainDocument): DomainNode[] {
  const flows = doc.nodes.filter(node => node.type === 'flow')
  if (!doc.overview?.featuredFlows?.length) return flows
  const byId = new Map(flows.map(node => [node.id, node]))
  return doc.overview.featuredFlows.map(id => byId.get(id)).filter((node): node is DomainNode => Boolean(node))
}

/** Only explicit page-to-page navigation is a navigation edge. */
export function pageViewData(doc: DomainDocument) {
  const pages = doc.nodes.filter(node => node.type === 'page')
  const ids = new Set(pages.map(node => node.id))
  const navigation = doc.edges.filter(edge => edge.type === 'navigates' && ids.has(edge.from) && ids.has(edge.to))
  return { pages, navigation }
}

export function pageAssociations(doc: DomainDocument, pageId: string) {
  const nodes = new Map(doc.nodes.map(node => [node.id, node]))
  const direct = doc.edges.filter(edge => (edge.from === pageId || edge.to === pageId) && edge.type !== 'navigates')
    .map(edge => ({ node: nodes.get(edge.from === pageId ? edge.to : edge.from), edge }))
    .filter((item): item is { node: DomainNode; edge: DomainEdge } => Boolean(item.node) && item.node!.id !== pageId)
  const directlyLinked = new Set(direct.map(item => item.node.id))
  const flows = (doc.flows ?? []).filter(flow => flow.steps.some(step => step.node === pageId) && !directlyLinked.has(flow.id))
    .map(flow => nodes.get(flow.id)).filter((node): node is DomainNode => Boolean(node) && node!.type === 'flow')
  return { direct, flows }
}
