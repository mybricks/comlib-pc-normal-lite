import YAML from 'yaml'
import type { NewSummaryBind, NewSummaryData, NewSummaryItem } from '../md/transformForNotifyChanged'

export const MYBRICKS_GRAPH_DIR = '.lingchuang/graph'

export type FileLike = {
  fileName: string
  source?: string
  jsDocMap?: string
}

export interface MybricksGraphDocument {
  data: NewSummaryData
  /** 页面节点对应的 TSX/JSX 文件名，来自顶层数组里 type: page 的节点。 */
  fileName: string
}

type GraphRelation = {
  name: string
  type: 'page' | 'popup'
}

type GraphNodeType = 'page' | 'component' | 'popup'

type GraphDatasourceEntry = {
  bind: NewSummaryBind
  api: string
  desc: string
}

type GraphStateEntry = {
  bind: NewSummaryBind
  field: string
  desc: string
}

type GraphEventEntry = {
  bind: NewSummaryBind
  name: string
  title: string
  mermaid: string
  relations?: GraphRelation[]
}

type GraphNode = {
  name: string
  fileName: string
  title: string
  summary: string
  type: GraphNodeType
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
  // 首个 selector token 必须是 class 或 id；后续 token 允许使用标签名及其
  // class/id 组合，例如 ".wait_content button"、"#dialog button.primary"。
  const firstSelectorToken = '(?:[.#][A-Za-z_][\\w-]*)+'
  const selectorToken = '(?:(?:(?:[A-Za-z_][\\w-]*|\\*)?(?:[.#][A-Za-z_][\\w-]*)+)|[A-Za-z_][\\w-]*|\\*)'
  const selectorPattern = new RegExp(`^${firstSelectorToken}(?:(?:\\s*(?:[>+~])\\s*|\\s+)${selectorToken})*$`)
  if (selectorPattern.test(selector)) return selector
  throw new Error(`MyBricks graph YAML 的 ${path} 必须使用以 ".className" 或 "#id" 开头的 CSS selector`)
}

/**
 * loc 使用 JSXTag:startLine-endLine，例如 Button:42-44；单行可省略 -endLine。
 */
function parseLocation(value: unknown, path: string) {
  if (typeof value !== 'string') {
    throw new Error(`MyBricks graph YAML 的 ${path} 必须使用 "JSXTag:startLine-endLine" 字符串，例如 "Button:42-44"`)
  }
  const match = value.trim().match(/^([A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$]*)*):([1-9]\d*)(?:-([1-9]\d*))?$/)
  if (!match) {
    throw new Error(`MyBricks graph YAML 的 ${path} 必须使用 "JSXTag:startLine-endLine" 格式，例如 "Button:42-44"`)
  }
  const [, tag, startLineText, endLineText] = match
  const startLine = Number(startLineText)
  const endLine = endLineText ? Number(endLineText) : startLine
  return { tag, startLine, endLine }
}

function parseEntryBind(entry: Record<string, any>, path: string, allowRoot: boolean): NewSummaryBind {
  if (entry.bind !== undefined) {
    throw new Error(`MyBricks graph YAML 的 ${path}.bind 已不支持，请将 loc 和 selector 提到当前条目顶层`)
  }
  if (entry.selector === undefined && entry.loc === undefined) {
    throw new Error(`MyBricks graph YAML 的 ${path} 至少需要 loc 或 selector 之一`)
  }
  return {
    ...(entry.selector === undefined ? {} : { selector: parseSelector(entry.selector, `${path}.selector`, allowRoot) }),
    ...(entry.loc === undefined ? {} : { loc: parseLocation(entry.loc, `${path}.loc`) }),
  }
}

function getBindKey(bind: NewSummaryBind): string {
  return JSON.stringify(bind)
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
    const bind = parseEntryBind(entry, `${path}[${index}]`, true)
    const api = requiredString(entry.api, `${path}[${index}].api`)
    const key = `${getBindKey(bind)}\u0000${api}`
    if (seen.has(key)) {
      throw new Error(`MyBricks graph YAML 的 ${path} 存在重复的 bind/api：${api}`)
    }
    seen.add(key)
    return {
      bind,
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
    const bind = parseEntryBind(entry, `${path}[${index}]`, true)
    const field = requiredString(entry.field, `${path}[${index}].field`)
    const key = `${getBindKey(bind)}\u0000${field}`
    if (seen.has(key)) {
      throw new Error(`MyBricks graph YAML 的 ${path} 存在重复的 bind/field：${field}`)
    }
    seen.add(key)
    return {
      bind,
      field,
      desc: requiredString(entry.desc, `${path}[${index}].desc`),
    }
  })
}

function parseEvents(value: unknown, path: string): GraphEventEntry[] | undefined {
  if (value === undefined) return undefined

  const entries = requiredArray(value, path)
  return entries.map((item, index) => {
    const entry = requiredRecord(item, `${path}[${index}]`)
    const bind = parseEntryBind(entry, `${path}[${index}]`, false)
    const name = requiredString(entry.name, `${path}[${index}].name`)
    return {
      bind,
      name,
      title: requiredString(entry.title, `${path}[${index}].title`),
      mermaid: requiredString(entry.mermaid, `${path}[${index}].mermaid`),
      relations: parseRelations(entry.relations, `${path}[${index}].relations`),
    }
  })
}

function toSummaryItem(
  node: GraphNode,
  path: string,
): NewSummaryItem {
  const item: NewSummaryItem = {
    name: node.name,
    fileName: node.fileName,
    title: node.title,
    summary: node.summary,
    type: node.type,
  }

  const datasource = parseDatasource(node.datasource, `${path}.datasource`)
  const state = parseState(node.state, `${path}.state`)
  const events = parseEvents(node.events, `${path}.events`)

  if (datasource?.length) {
    item.datasource = datasource
  }

  if (state?.length) {
    item.state = state
  }

  if (events?.length) {
    item.events = events.map(entry => ({
      bind: entry.bind,
      name: entry.name,
      title: entry.title,
      mermaid: entry.mermaid,
      ...(entry.relations ? { relations: Object.fromEntries(entry.relations.map(relation => [relation.name, { type: relation.type }])) } : {}),
    }))
  }

  return item
}

function parseGraphNode(value: unknown, index: number): GraphNode {
  const path = `[${index}]`
  const node = requiredRecord(value, path)
  const type = requiredString(node.type, `${path}.type`)
  if (type !== 'page' && type !== 'component' && type !== 'popup') {
    throw new Error(`MyBricks graph YAML 的 ${path}.type 只能是 page、component 或 popup`)
  }
  return {
    name: requiredString(node.name, `${path}.name`),
    fileName: normalizeFileName(requiredString(node.fileName, `${path}.fileName`)),
    title: requiredString(node.title, `${path}.title`),
    summary: requiredString(node.summary, `${path}.summary`),
    type,
    datasource: node.datasource,
    state: node.state,
    events: node.events,
  }
}

/**
 * 解析一个 .lingchuang/graph 页面 YAML，并编译为设计器使用的节点 Map。
 *
 * 顶层是一个节点数组：第一个元素是 version，后续每个元素是 page / component /
 * popup 节点，三者平级、由 type 区分。不在使用独立的 page / nodes 两层。
 * 页面对应文件的定位取自第一个 type: page 的节点；若 YAML 没有显式 page 节点
 * （例如组件即页面、测试组件等场景），回退到第一个节点。
 */
export function parseMybricksGraph(content: string): MybricksGraphDocument {
  const raw = YAML.parse(content)
  if (!Array.isArray(raw)) {
    throw new Error('MyBricks graph YAML 顶层必须是节点数组')
  }
  if (raw.length === 0) {
    throw new Error('MyBricks graph YAML 不能为空数组')
  }

  // 第一个元素是 version 节点（`- version: 1`），跳过；其余都是图节点。
  const nodes = raw.slice(1)
  if (nodes.length === 0) {
    throw new Error('MyBricks graph YAML 除 version 外至少需要一个节点')
  }

  const data: NewSummaryData = {}
  let pageFileName: string | null = null
  let firstFileName: string | null = null

  nodes.forEach((value, index) => {
    const node = parseGraphNode(value, index)
    if (data[node.name]) {
      throw new Error(`MyBricks graph YAML 存在重复节点：${node.name}`)
    }
    data[node.name] = toSummaryItem(node, `[${index}]`)
    if (firstFileName === null) firstFileName = node.fileName
    if (!pageFileName && node.type === 'page') {
      pageFileName = node.fileName
    }
  })

  const fileName = pageFileName ?? firstFileName
  if (!fileName) {
    throw new Error('MyBricks graph YAML 至少需要一个带 fileName 的节点')
  }

  return { data, fileName }
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

/** 页面文件使用顶层数组中 type: page 节点的 fileName；没有时回退第一个节点。 */
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
