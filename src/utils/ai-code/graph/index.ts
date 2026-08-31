import YAML from 'yaml'
import { parse as parseCssSelector } from 'css-tree'
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
  /** 页面节点的路由，来自顶层数组里 type: page 的节点。 */
  route?: string
}

type GraphRelation = {
  name: string
  type: string
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
  route?: string
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

function warnGraphIssue(path: string, message: string): void {
  console.warn(`MyBricks graph YAML 的 ${path} ${message}`)
}

function requiredString(value: unknown, path: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    warnGraphIssue(path, '必须是非空字符串')
    return undefined
  }
  return value.trim()
}

function requiredRecord(value: unknown, path: string): Record<string, any> | undefined {
  if (!isRecord(value)) {
    warnGraphIssue(path, '必须是对象')
    return undefined
  }
  return value
}

function requiredArray(value: unknown, path: string): unknown[] | undefined {
  if (!Array.isArray(value)) {
    warnGraphIssue(path, '必须是数组')
    return undefined
  }
  return value
}

function parseSelector(value: unknown, path: string, allowRoot: boolean): string | undefined {
  const selector = requiredString(value, path)
  if (!selector) return undefined
  if (allowRoot && selector === 'root') return selector
  // 元素定位必须从 class 或 id 开始；其余部分交给 CSS 解析器校验，支持
  // 属性选择器、伪类/伪元素、嵌套后代等合法 CSS selector 写法。
  const startsWithClassOrId = /^(?:\.[A-Za-z_][\w-]*|#[A-Za-z_][\w-]*)/.test(selector)
  if (startsWithClassOrId) {
    try {
      parseCssSelector(selector, { context: 'selector' })
      return selector
    } catch {
      // 统一使用 graph YAML 的字段路径报告格式错误。
    }
  }
  warnGraphIssue(path, '必须使用以 ".className" 或 "#id" 开头的 CSS selector')
  return undefined
}

/**
 * loc 使用 JSXTag:startLine-endLine，例如 Button:42-44；单行可省略 -endLine。
 */
function parseLocation(value: unknown, path: string) {
  if (typeof value !== 'string') {
    warnGraphIssue(path, '必须使用 "JSXTag:startLine-endLine" 字符串，例如 "Button:42-44"')
    return undefined
  }
  const match = value.trim().match(/^([A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$]*)*):([1-9]\d*)(?:-([1-9]\d*))?$/)
  if (!match) {
    warnGraphIssue(path, '必须使用 "JSXTag:startLine-endLine" 格式，例如 "Button:42-44"')
    return undefined
  }
  const [, tag, startLineText, endLineText] = match
  const startLine = Number(startLineText)
  const endLine = endLineText ? Number(endLineText) : startLine
  return { tag, startLine, endLine }
}

function parseEntryBind(entry: Record<string, any>, path: string, allowRoot: boolean): NewSummaryBind | undefined {
  if (entry.bind !== undefined) {
    warnGraphIssue(path + '.bind', '已不支持，请将 loc 和 selector 提到当前条目顶层')
    return undefined
  }
  if (entry.selector === undefined && entry.loc === undefined) {
    warnGraphIssue(path, '至少需要 loc 或 selector 之一')
    return undefined
  }
  const selector = entry.selector === undefined ? undefined : parseSelector(entry.selector, `${path}.selector`, allowRoot)
  if (entry.selector !== undefined && !selector) return undefined
  const loc = entry.loc === undefined || entry.selector === 'root' ? undefined : parseLocation(entry.loc, `${path}.loc`)
  if (entry.loc !== undefined && entry.selector !== 'root' && !loc) return undefined
  return {
    ...(selector === undefined ? {} : { selector }),
    ...(loc === undefined ? {} : { loc }),
  }
}

function getBindKey(bind: NewSummaryBind): string {
  return JSON.stringify(bind)
}

function parseRelations(value: unknown, path: string): GraphRelation[] | undefined {
  if (value === undefined) return undefined

  const entries = requiredArray(value, path)
  if (!entries) return undefined

  const relations: GraphRelation[] = []
  entries.forEach((item, index) => {
    const relation = requiredRecord(item, `${path}[${index}]`)
    if (!relation) return
    const type = requiredString(relation.type, `${path}[${index}].type`)
    if (!type) return
    if (type !== 'page' && type !== 'popup') {
      warnGraphIssue(`${path}[${index}].type`, `只能是 page 或 popup，当前值为 "${type}"`)
      return
    }
    const name = requiredString(relation.name, `${path}[${index}].name`)
    if (!name) return
    relations.push({ name, type })
  })

  return relations.length ? relations : undefined
}

function parseDatasource(value: unknown, path: string): GraphDatasourceEntry[] | undefined {
  if (value === undefined) return undefined

  const entries = requiredArray(value, path)
  if (!entries) return undefined

  const seen = new Set<string>()
  const result: GraphDatasourceEntry[] = []
  entries.forEach((item, index) => {
    const entry = requiredRecord(item, `${path}[${index}]`)
    if (!entry) return
    const bind = parseEntryBind(entry, `${path}[${index}]`, true)
    if (!bind) return
    const api = requiredString(entry.api, `${path}[${index}].api`)
    if (!api) return
    const key = `${getBindKey(bind)}\u0000${api}`
    if (seen.has(key)) {
      warnGraphIssue(path, `存在重复的 bind/api：${api}`)
      return
    }
    seen.add(key)
    const desc = requiredString(entry.desc, `${path}[${index}].desc`)
    if (!desc) return
    result.push({
      bind,
      api,
      desc,
    })
  })

  return result.length ? result : undefined
}

function parseState(value: unknown, path: string): GraphStateEntry[] | undefined {
  if (value === undefined) return undefined

  const entries = requiredArray(value, path)
  if (!entries) return undefined

  const seen = new Set<string>()
  const result: GraphStateEntry[] = []
  entries.forEach((item, index) => {
    const entry = requiredRecord(item, `${path}[${index}]`)
    if (!entry) return
    const bind = parseEntryBind(entry, `${path}[${index}]`, true)
    if (!bind) return
    const field = requiredString(entry.field, `${path}[${index}].field`)
    if (!field) return
    const key = `${getBindKey(bind)}\u0000${field}`
    if (seen.has(key)) {
      warnGraphIssue(path, `存在重复的 bind/field：${field}`)
      return
    }
    seen.add(key)
    const desc = requiredString(entry.desc, `${path}[${index}].desc`)
    if (!desc) return
    result.push({
      bind,
      field,
      desc,
    })
  })

  return result.length ? result : undefined
}

function parseEvents(value: unknown, path: string): GraphEventEntry[] | undefined {
  if (value === undefined) return undefined

  const entries = requiredArray(value, path)
  if (!entries) return undefined

  const result: GraphEventEntry[] = []
  entries.forEach((item, index) => {
    const entry = requiredRecord(item, `${path}[${index}]`)
    if (!entry) return
    const bind = parseEntryBind(entry, `${path}[${index}]`, false)
    if (!bind) return
    const name = requiredString(entry.name, `${path}[${index}].name`)
    if (!name) return
    const title = requiredString(entry.title, `${path}[${index}].title`)
    if (!title) return
    const mermaid = requiredString(entry.mermaid, `${path}[${index}].mermaid`)
    if (!mermaid) return
    result.push({
      bind,
      name,
      title,
      mermaid,
      relations: parseRelations(entry.relations, `${path}[${index}].relations`),
    })
  })

  return result.length ? result : undefined
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

function parseGraphNode(value: unknown, index: number): GraphNode | undefined {
  const path = `[${index}]`
  const node = requiredRecord(value, path)
  if (!node) {
    return undefined
  }
  const type = requiredString(node.type, `${path}.type`)
  if (!type) {
    return undefined
  }
  if (type !== 'page' && type !== 'component' && type !== 'popup') {
    warnGraphIssue(`${path}.type`, '只能是 page、component 或 popup')
    return undefined
  }
  const name = requiredString(node.name, `${path}.name`)
  const fileName = requiredString(node.fileName, `${path}.fileName`)
  const title = requiredString(node.title, `${path}.title`)
  const summary = requiredString(node.summary, `${path}.summary`)
  if (!name || !fileName || !title || !summary) {
    return undefined
  }
  const route = node.route === undefined ? undefined : requiredString(node.route, `${path}.route`)
  return {
    name,
    fileName: normalizeFileName(fileName),
    ...(route ? { route } : {}),
    title,
    summary,
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
  let raw: unknown
  try {
    raw = YAML.parse(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnGraphIssue('顶层', `YAML 解析失败：${message}`)
    return { data: {}, fileName: '' }
  }
  if (!Array.isArray(raw)) {
    warnGraphIssue('顶层', '必须是节点数组')
    return { data: {}, fileName: '' }
  }
  if (raw.length === 0) {
    warnGraphIssue('顶层', '不能为空数组')
    return { data: {}, fileName: '' }
  }

  // 第一个元素是 version 节点（`- version: 1`），跳过；其余都是图节点。
  const nodes = raw.slice(1)
  if (nodes.length === 0) {
    warnGraphIssue('顶层', '除 version 外至少需要一个节点')
    return { data: {}, fileName: '' }
  }

  const data: NewSummaryData = {}
  let pageFileName: string | null = null
  let pageRoute: string | undefined
  let firstFileName: string | null = null

  nodes.forEach((value, index) => {
    const node = parseGraphNode(value, index)
    if (!node) return
    if (data[node.name]) {
      warnGraphIssue('顶层', `存在重复节点：${node.name}`)
      return
    }
    data[node.name] = toSummaryItem(node, `[${index}]`)
    if (firstFileName === null) firstFileName = node.fileName
    if (!pageFileName && node.type === 'page') {
      pageFileName = node.fileName
      pageRoute = node.route
    }
  })

  const fileName = pageFileName ?? firstFileName
  if (!fileName) {
    warnGraphIssue('顶层', '至少需要一个带 fileName 的节点')
    return { data, fileName: '' }
  }

  return { data, fileName, ...(pageRoute === undefined ? {} : { route: pageRoute }) }
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
