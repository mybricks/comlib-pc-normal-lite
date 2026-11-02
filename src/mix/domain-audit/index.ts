import { parse } from 'yaml'
import { analyzeDomainSource, type DomainSourceFile } from './analysis'

export type DomainPanelConfig = { documentPath: string }
export type DomainCanvasEntry = { file?: string; name?: string; kind?: string; canvasPath?: string }
const panels = new Map<string, DomainPanelConfig>()
const listeners = new Set<() => void>()
export const getDomainPanel = (id: string) => panels.get(id)
export function subscribeDomainPanels(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function markdownSection(title: string, items: string[]): string {
  return `### ${title}\n${items.length ? items.map(item => `- ${item}`).join('\n') : '- None found'}`
}

function resolveImport(file: string, source: string, files: DomainSourceFile[]): string | undefined {
  if (!source.startsWith('.')) return undefined
  const parts = file.split('/').slice(0, -1)
  for (const segment of source.split('/')) {
    if (segment === '..') parts.pop()
    else if (segment && segment !== '.') parts.push(segment)
  }
  const base = parts.join('/')
  const candidates = [base, ...['.tsx', '.ts', '.jsx', '.js'].map(ext => base + ext), ...['tsx', 'ts', 'jsx', 'js'].map(ext => `${base}/index.${ext}`)]
  return candidates.find(candidate => files.some(item => item.path.replace(/^\.\//, '') === candidate))
}

function paginate(items: string[], offset: number, limit: number): string {
  const page = items.slice(offset, offset + limit)
  const next = offset + limit < items.length ? `Continue the same query with offset: ${offset + limit} and limit: ${limit}.` : 'No more results.'
  return [page.length ? page.map(item => `- ${item}`).join('\n') : '- None found', next].join('\n\n')
}

function formatValidation(path: string, issues: string[]): string {
  return [
    `## Domain document validation: ${path}`,
    issues.length ? `Validation failed.\n\n${markdownSection('Issues', issues)}` : 'Document structure and references passed validation.',
    'Validation cannot establish business semantics.',
  ].join('\n\n')
}

/** Host implementation injected only when the audit-domain plugin is enabled. */
export function createDomainAuditImplementation(
  id: string,
  getFiles: () => Promise<DomainSourceFile[]>,
  getCanvasEntries: () => DomainCanvasEntry[] = () => [],
) {
  return {
    enable({ documentPath }: DomainPanelConfig) {
      panels.set(id, { documentPath })
      listeners.forEach(listener => listener())
    },
    async understandDomain(params: { path?: string; symbol?: string; offset?: number; limit?: number }) {
      const files = await getFiles()
      const path = (params.path || '').replace(/^\.\//, '')
      const limit = Math.max(1, Math.min(20, Math.floor(params.limit || 10)))
      const offset = Math.max(0, Math.floor(params.offset || 0))
      if (!path || path === '.') {
        if (params.symbol) throw new Error('A source file path is required when inspecting a symbol.')
        const entries = getCanvasEntries()
        const items = entries.map(entry => {
          const name = entry.name || 'Unnamed'
          const kind = entry.kind || 'unknown'
          const source = entry.file ? `source: ${entry.file} — inspect with path: ${entry.file}` : 'source unavailable'
          return `${name} (${kind}) — ${source}${entry.canvasPath ? ` — canvas path: ${entry.canvasPath}` : ''}`
        })
        return { output: [
          `## Canvas entries (${entries.length})`,
          paginate(items, offset, limit),
          'Select an entry source path to inspect its declarations. Missing canvas entries or source paths mean coverage is incomplete.',
        ].join('\n\n') }
      }
      const file = files.find(item => item.path.replace(/^\.\//, '') === path)
      if (!file) throw new Error(`Source file not found: ${path}`)
      if (!/\.[cm]?[jt]sx?$/i.test(path)) throw new Error(`Unsupported source file: ${path}`)
      const result = analyzeDomainSource(file, params.symbol)
      if (result.diagnostics.length) return { output: `## Diagnostics: ${path}\n\n${result.diagnostics.map(item => `- ${item}`).join('\n')}` }
      if (!params.symbol) {
        const items = result.symbols.map(item => `${item.name} (${item.kind}, line ${item.line}) — inspect with path: ${path}, symbol: ${item.name}`)
        return { output: [`## Declarations: ${path}`, paginate(items, offset, limit), 'Choose a declaration to inspect its JSX references and call candidates.'].join('\n\n') }
      }
      const items = result.relations.map(item => {
        const target = item.source ? resolveImport(path, item.source, files) : undefined
        const localSymbol = item.name.split('.')[0]
        const follow = target ? ` — imported from ${item.source}; inspect with path: ${target}` : item.source ? ` — imported from ${item.source}; target unresolved` : result.symbols.some(candidate => candidate.name === localSymbol) ? ` — local declaration; inspect with path: ${path}, symbol: ${localSymbol}` : ''
        return `${item.kind}: ${item.name} (${path}:${item.line})${follow}`
      })
      return { output: [
        `## References and calls: ${params.symbol} in ${path}`,
        paginate(items, offset, limit),
        'These are syntactic candidates, not proof of runtime calls or business relationships. Aliases, dynamic imports and re-exports may be unresolved.',
      ].join('\n\n') }
    },
    async validateDomain({ path }: { path: string }) {
      const files = await getFiles()
      const source = files.find(file => file.path.replace(/^\.\//, '') === path)
      if (!source) throw new Error(`Document not found: ${path}`)
      const issues: string[] = []
      let doc: any
      try { doc = parse(source.content) } catch (error) { return { output: formatValidation(path, [String(error)]) } }
      if (doc?.version !== 1 || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return { output: formatValidation(path, ['Expected version: 1 and nodes/edges arrays.']) }
      const ids = new Set<string>()
      for (const node of doc.nodes) {
        if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id)) issues.push(`Invalid or duplicate node id: ${node?.id}`)
        else ids.add(node.id)
        if (!node?.type || !node?.title || !node?.summary) issues.push(`Missing type, title or summary: ${node?.id}`)
        if (node?.evidence !== undefined && !Array.isArray(node.evidence)) issues.push(`Invalid evidence: ${node.id}`)
        for (const evidence of Array.isArray(node?.evidence) ? node.evidence : []) {
          const target = files.find(file => file.path.replace(/^\.\//, '') === evidence?.file)
          if (!target) issues.push(`Evidence file unavailable: ${evidence?.file}`)
          else if (evidence.line !== undefined && (!Number.isInteger(evidence.line) || evidence.line < 1 || evidence.line > target.content.split('\n').length)) issues.push(`Invalid evidence line: ${evidence.file}:${evidence.line}`)
        }
      }
      for (const edge of doc.edges) if (!ids.has(edge?.from) || !ids.has(edge?.to) || !edge?.type) issues.push(`Invalid edge: ${edge?.from} -> ${edge?.to}`)
      if (doc.flows !== undefined && !Array.isArray(doc.flows)) issues.push('Invalid flows')
      const flowIds = new Set<string>()
      for (const flow of Array.isArray(doc.flows) ? doc.flows : []) {
        if (!flow || flowIds.has(flow.id) || !doc.nodes.some((node: any) => node.id === flow.id && node.type === 'flow')) { issues.push(`Invalid flow: ${flow?.id}`); continue }
        flowIds.add(flow.id)
        if (!Array.isArray(flow.steps) || !Array.isArray(flow.transitions)) { issues.push(`Invalid flow steps or transitions: ${flow.id}`); continue }
        const steps = new Set<string>()
        for (const step of flow.steps) {
          if (!step?.id || !step?.title || steps.has(step.id) || (step.node && !ids.has(step.node))) issues.push(`Invalid flow step: ${flow.id}`)
          else steps.add(step.id)
        }
        for (const edge of flow.transitions) if (!steps.has(edge?.from) || !steps.has(edge?.to)) issues.push(`Invalid flow transition: ${flow.id}`)
      }
      return { output: formatValidation(path, issues) }
    },
  }
}
