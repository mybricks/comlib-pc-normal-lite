import YAML from 'yaml'
import type { NewSummaryData, NewSummaryItem } from '../md/transformForNotifyChanged'

export const MYBRICKS_GRAPH_DIR = '.myrbicks/graph'

export type FileLike = {
  fileName: string
  source?: string
  jsDocMap?: string
}

export interface MybricksGraphDocument {
  data: NewSummaryData
  /** 页面对应的 TSX/JSX 文件名，必须来自 YAML 的 page.fileName。 */
  fileName: string
}

type GraphRelation = {
  name: string
  type: 'page' | 'popup'
}

type GraphDatasourceEntry = {
  selector: string
  api: string
  desc: string
}

type GraphStateEntry = {
  selector: string
  field: string
  desc: string
}

type GraphEventEntry = {
  selector: string
  name: string
  title: string
  mermaid: string
  relations?: GraphRelation[]
}

type GraphNode = {
  name: string
  title: string
  summary: string
  type: 'component' | 'popup'
  datasource?: GraphDatasourceEntry[]
  state?: GraphStateEntry[]
  events?: GraphEventEntry[]
}

type GraphPage = {
  name: string
  fileName: string
  title: string
  summary: string
  type: 'page'
  datasource?: GraphDatasourceEntry[]
  state?: GraphStateEntry[]
  events?: GraphEventEntry[]
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeFileName(fileName: string): string {
  return fileName.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`MyBricks graph YAML 的 ${path} 必须是非空字符串`)
  }
  return value.trim()
}

function requiredRecord(value: unknown, path: string): Record<string, any> {
  if (!isRecord(value)) {
    throw new Error(`MyBricks graph YAML 的 ${path} 必须是对象`)
  }
  return value
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`MyBricks graph YAML 的 ${path} 必须是数组`)
  }
  return value
}

function parseSelector(value: unknown, path: string, allowRoot: boolean): string {
  const selector = requiredString(value, path)
  if (allowRoot && selector === 'root') return selector
  // 支持单个 selector，也支持页面中常见的后代/组合 selector，
  // 例如 ".settle-header .backBtn"；每个元素定位 token 仍必须以 . 或 # 开头。
  const selectorToken = '(?:[.#][A-Za-z_][\\w-]*)+'
  const selectorPattern = new RegExp(`^${selectorToken}(?:(?:\\s*(?:[>+~])\\s*|\\s+)${selectorToken})*$`)
  if (selectorPattern.test(selector)) return selector
  throw new Error(`MyBricks graph YAML 的 ${path} 必须使用以 ".className" 或 "#id" 开头的 CSS selector`)
}

function parseRelations(value: unknown, path: string): GraphRelation[] | undefined {
  if (value === undefined) return undefined

  return requiredArray(value, path).map((item, index) => {
    const relation = requiredRecord(item, `${path}[${index}]`)
    const type = requiredString(relation.type, `${path}[${index}].type`)
    if (type !== 'page' && type !== 'popup') {
      throw new Error(`MyBricks graph YAML 的 ${path}[${index}].type 只能是 page 或 popup`)
    }
    return {
      name: requiredString(relation.name, `${path}[${index}].name`),
      type,
    }
  })
}

function parseDatasource(value: unknown, path: string): GraphDatasourceEntry[] | undefined {
  if (value === undefined) return undefined

  const entries = requiredArray(value, path)
  const seen = new Set<string>()
  return entries.map((item, index) => {
    const entry = requiredRecord(item, `${path}[${index}]`)
    const selector = parseSelector(entry.selector, `${path}[${index}].selector`, true)
    const api = requiredString(entry.api, `${path}[${index}].api`)
    const key = `${selector}\u0000${api}`
    if (seen.has(key)) {
      throw new Error(`MyBricks graph YAML 的 ${path} 存在重复的 selector/api：${selector} + ${api}`)
    }
    seen.add(key)
    return {
      selector,
      api,
      desc: requiredString(entry.desc, `${path}[${index}].desc`),
    }
  })
}

function parseState(value: unknown, path: string): GraphStateEntry[] | undefined {
  if (value === undefined) return undefined

  const entries = requiredArray(value, path)
  const seen = new Set<string>()
  return entries.map((item, index) => {
    const entry = requiredRecord(item, `${path}[${index}]`)
    const selector = parseSelector(entry.selector, `${path}[${index}].selector`, true)
    const field = requiredString(entry.field, `${path}[${index}].field`)
    const key = `${selector}\u0000${field}`
    if (seen.has(key)) {
      throw new Error(`MyBricks graph YAML 的 ${path} 存在重复的 selector/field：${selector} + ${field}`)
    }
    seen.add(key)
    return {
      selector,
      field,
      desc: requiredString(entry.desc, `${path}[${index}].desc`),
    }
  })
}

function parseEvents(value: unknown, path: string): GraphEventEntry[] | undefined {
  if (value === undefined) return undefined

  const entries = requiredArray(value, path)
  const seen = new Set<string>()
  return entries.map((item, index) => {
    const entry = requiredRecord(item, `${path}[${index}]`)
    const selector = parseSelector(entry.selector, `${path}[${index}].selector`, false)
    const name = requiredString(entry.name, `${path}[${index}].name`)
    const key = `${selector}\u0000${name}`
    if (seen.has(key)) {
      throw new Error(`MyBricks graph YAML 的 ${path} 存在重复的 selector/name：${selector} + ${name}`)
    }
    seen.add(key)
    return {
      selector,
      name,
      title: requiredString(entry.title, `${path}[${index}].title`),
      mermaid: requiredString(entry.mermaid, `${path}[${index}].mermaid`),
      relations: parseRelations(entry.relations, `${path}[${index}].relations`),
    }
  })
}

function toSummaryItem(
  node: GraphPage | GraphNode,
  path: string,
): NewSummaryItem {
  const item: NewSummaryItem = {
    name: node.name,
    title: node.title,
    summary: node.summary,
    type: node.type,
  }

  const datasource = parseDatasource(node.datasource, `${path}.datasource`)
  const state = parseState(node.state, `${path}.state`)
  const events = parseEvents(node.events, `${path}.events`)

  if (datasource?.length) {
    item.datasource = {}
    for (const entry of datasource) {
      item.datasource[entry.selector] ??= {}
      item.datasource[entry.selector][entry.api] = { desc: entry.desc }
    }
  }

  if (state?.length) {
    item.state = {}
    for (const entry of state) {
      item.state[entry.selector] ??= {}
      item.state[entry.selector][entry.field] = { desc: entry.desc }
    }
  }

  if (events?.length) {
    item.events = {}
    for (const entry of events) {
      item.events[entry.selector] ??= {}
      item.events[entry.selector][entry.name] = {
        title: entry.title,
        mermaid: entry.mermaid,
        ...(entry.relations ? { relations: Object.fromEntries(entry.relations.map(relation => [relation.name, { type: relation.type }])) } : {}),
      }
    }
  }

  return item
}

function parsePage(value: unknown): GraphPage {
  const page = requiredRecord(value, 'page')
  return {
    name: requiredString(page.name, 'page.name'),
    fileName: normalizeFileName(requiredString(page.fileName, 'page.fileName')),
    title: requiredString(page.title, 'page.title'),
    summary: requiredString(page.summary, 'page.summary'),
    type: 'page',
    datasource: page.datasource,
    state: page.state,
    events: page.events,
  }
}

function parseNode(value: unknown, index: number): GraphNode {
  const path = `nodes[${index}]`
  const node = requiredRecord(value, path)
  const type = requiredString(node.type, `${path}.type`)
  if (type !== 'component' && type !== 'popup') {
    throw new Error(`MyBricks graph YAML 的 ${path}.type 只能是 component 或 popup`)
  }
  return {
    name: requiredString(node.name, `${path}.name`),
    title: requiredString(node.title, `${path}.title`),
    summary: requiredString(node.summary, `${path}.summary`),
    type,
    datasource: node.datasource,
    state: node.state,
    events: node.events,
  }
}

/** 解析一个 .myrbicks/graph 页面 YAML，并编译为设计器使用的节点 Map。 */
export function parseMybricksGraph(content: string): MybricksGraphDocument {
  const parsed = requiredRecord(YAML.parse(content), '根节点')
  if (parsed.version !== 1) {
    throw new Error('MyBricks graph YAML 的 version 必须是 1')
  }
  const unknownKeys = Object.keys(parsed).filter(key => !['version', 'page', 'nodes'].includes(key))
  if (unknownKeys.length > 0) {
    throw new Error(`MyBricks graph YAML 存在未知根字段：${unknownKeys.join(', ')}`)
  }

  const page = parsePage(parsed.page)
  const nodes = requiredArray(parsed.nodes, 'nodes').map(parseNode)
  const data: NewSummaryData = {}

  if (data[page.name]) {
    throw new Error(`MyBricks graph YAML 存在重复节点：${page.name}`)
  }
  data[page.name] = toSummaryItem(page, 'page')

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (data[node.name]) {
      throw new Error(`MyBricks graph YAML 存在重复节点：${node.name}`)
    }
    data[node.name] = toSummaryItem(node, `nodes[${index}]`)
  }

  return { data, fileName: page.fileName }
}

export function isMybricksGraphFile(fileName: string): boolean {
  const normalized = normalizeFileName(fileName)
  return normalized.startsWith(`${MYBRICKS_GRAPH_DIR}/`) && /\.(yaml|yml)$/i.test(normalized)
}

/** 先判断固定 graph 目录是否存在，再决定是否尝试 YAML 文档链路。 */
export function hasMybricksGraphDirectory(files: FileLike[]): boolean {
  return files.some(file => {
    const normalized = normalizeFileName(file.fileName)
    return normalized === MYBRICKS_GRAPH_DIR || normalized.startsWith(`${MYBRICKS_GRAPH_DIR}/`)
  })
}

export function hasMybricksGraphFile(files: FileLike[]): boolean {
  return files.some(file => isMybricksGraphFile(file.fileName))
}

/** 页面文件只使用 YAML 中显式声明的 page.fileName，不按文件名猜测。 */
export function resolveGraphSourceFile(
  _graphFileName: string,
  graph: MybricksGraphDocument,
  _files: FileLike[],
): string {
  return graph.fileName
}

function decodeSource(source?: string): string {
  if (!source) return ''
  try {
    return decodeURIComponent(source)
  } catch {
    return source
  }
}

/** 读取 TSX 文件已编译保存的 JSDoc Map；空 Map 表示该文件没有可用 JSDoc。 */
export function getStoredJsDocMap(file?: FileLike): NewSummaryData {
  if (!file?.jsDocMap) return {}
  try {
    const parsed = JSON.parse(decodeSource(file.jsDocMap))
    return isRecord(parsed) ? parsed as NewSummaryData : {}
  } catch {
    return {}
  }
}

export function findGraphForSourceFile(
  sourceFileName: string,
  files: FileLike[],
): { fileName: string; graph: MybricksGraphDocument } | undefined {
  const normalizedSourceFileName = normalizeFileName(sourceFileName)
  for (const file of files) {
    if (!isMybricksGraphFile(file.fileName)) continue
    try {
      const graph = parseMybricksGraph(decodeSource(file.source))
      const targetFileName = resolveGraphSourceFile(file.fileName, graph, files)
      if (targetFileName === normalizedSourceFileName) {
        return { fileName: normalizeFileName(file.fileName), graph }
      }
    } catch {
      // 单个 graph 文件损坏时不影响其它页面文档和源码编译。
    }
  }
  return undefined
}

export function findSourceFile(fileName: string | undefined, files: FileLike[]): FileLike | undefined {
  if (!fileName) return undefined
  const normalized = normalizeFileName(fileName)
  return files.find(file => normalizeFileName(file.fileName) === normalized)
}
