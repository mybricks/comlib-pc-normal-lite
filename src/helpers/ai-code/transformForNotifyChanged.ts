/**
 * 给 refSelector 中每个子选择器追加 :not([data-wrap-container])，
 * 从而排除 wrapThirdPartyPlugin 注入的外层包裹 div（该 div 带有 data-wrap-container="true"）。
 */
export function excludeWrapContainer(refSelector: string): string {
  return refSelector
    .split(',')
    .map(s => `${s.trim()}:not([data-wrap-container])`)
    .join(', ')
}

/** JSX 源码定位。fileName 由所属 page/node 提供，避免每条绑定重复填写。 */
export type NewSummaryLocation = {
  tag: string
  startLine: number
  endLine: number
}

/** Graph 中元素的两种绑定方式：优先 loc，selector 保留为兼容链路。 */
export type NewSummaryBind = {
  selector?: string
  loc?: NewSummaryLocation
}

export type NewSummaryDatasourceEntry = {
  bind: NewSummaryBind
  api: string
  desc?: string
}

export type NewSummaryStateEntry = {
  bind: NewSummaryBind
  field: string
  desc?: string
}

export type NewSummaryEventEntry = {
  bind: NewSummaryBind
  name: string
  title?: string
  mermaid?: string
  relations?: Record<string, any>
}

type LegacySummaryEvent = Omit<NewSummaryEventEntry, 'bind' | 'name'>
type LegacySummaryEventValue = LegacySummaryEvent | LegacySummaryEvent[]
type LegacySummaryDatasource = Record<string, Record<string, { desc?: string }>>
type LegacySummaryState = Record<string, Record<string, { desc?: string }>>
type LegacySummaryEvents = Record<string, Record<string, LegacySummaryEventValue>>

export type NewSummaryItem = {
  name: string
  title: string
  summary: string
  type: string
  /** 节点对应的真实 TSX/JSX 文件；未填写时兼容调用方传入的页面文件。 */
  fileName?: string
  state?: NewSummaryStateEntry[] | LegacySummaryState
  events?: NewSummaryEventEntry[] | LegacySummaryEvents
  datasource?: NewSummaryDatasourceEntry[] | LegacySummaryDatasource
}

/** 新版 JSON 数据格式：组件名 → 组件描述 */
export type NewSummaryData = Record<string, NewSummaryItem>

function asEventDefinitions(value: LegacySummaryEventValue): LegacySummaryEvent[] {
  return Array.isArray(value) ? value : [value]
}

function normalizeDatasourceEntries(value: NewSummaryItem['datasource']): NewSummaryDatasourceEntry[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  return Object.entries(value).flatMap(([selector, apis]) =>
    Object.entries(apis).map(([api, { desc }]) => ({ bind: { selector }, api, desc })),
  )
}

function normalizeStateEntries(value: NewSummaryItem['state']): NewSummaryStateEntry[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  return Object.entries(value).flatMap(([selector, fields]) =>
    Object.entries(fields).map(([field, { desc }]) => ({ bind: { selector }, field, desc })),
  )
}

function normalizeEventEntries(value: NewSummaryItem['events']): NewSummaryEventEntry[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  return Object.entries(value).flatMap(([selector, handlers]) =>
    Object.entries(handlers).flatMap(([name, definitions]) =>
      asEventDefinitions(definitions).map(({ title, mermaid, relations }) => ({
        bind: { selector },
        name,
        title,
        mermaid,
        relations,
      })),
    ),
  )
}

type NotifyLocation = NewSummaryLocation & { fileName: string }
type NotifyBinding = { refSelector?: string; location?: NotifyLocation }

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function getNotifyLocation(bind: NewSummaryBind, fileName: string): NotifyLocation | undefined {
  return bind.loc ? { fileName, ...bind.loc } : undefined
}

function addNotifyBinding<T extends Record<string, any>>(
  result: T,
  bind: NewSummaryBind,
  fileName: string,
  getRefSelector: (selector: string) => string | undefined,
): T & NotifyBinding {
  const bindingResult = result as T & NotifyBinding
  if (bind.selector) {
    const refSelector = getRefSelector(bind.selector)
    if (refSelector) bindingResult.refSelector = refSelector
  }
  const location = getNotifyLocation(bind, fileName)
  if (location) {
    bindingResult.location = location
    const { startLine, endLine } = location
    const codeLine = `"codeLine":{"start":${startLine},"end":${endLine}}`
    bindingResult.refSelector = ['data-loc', 'data-parent-loc']
      .map(attribute =>
        `[${attribute}*='${escapeCssAttributeValue(fileName)}']` +
        `[${attribute}*='${escapeCssAttributeValue(codeLine)}']:not([data-wrap-container])`,
      )
      .join(', ')
  }
  return bindingResult
}

/** 当前节点的定位上下文；fileName 已应用节点文件名优先规则。 */
export type NotifySelectorContext = {
  componentName: string
  fileName: string
  info: NewSummaryItem
}

export type NotifySelectorOptions = {
  getRefSelector: (selector: string, context: NotifySelectorContext) => string | undefined
  /** 未提供时不输出事件关联。 */
  getRelationRefSelector?: (name: string, context: NotifySelectorContext) => string | undefined
  /** 未提供时不输出组件文档。 */
  getDocRefSelector?: (context: NotifySelectorContext) => string | undefined
}

/** 将 Graph/JSDoc 数据转换为 notifyChanged 数据，由调用方注入 DOM 定位策略。 */
export const transformSummaryForNotifyChanged = (
  data: NewSummaryData,
  filename: string,
  options: NotifySelectorOptions,
) => {
  const events: any[] = []
  const services: Array<{ title: string; description: string; type: 'up'; refType: string } & NotifyBinding> = []
  const state: Array<{ field: string; description: string } & NotifyBinding> = []
  const docs: Array<{ refSelector: string; name: string; title: string; summary: string; type: string }> = []

  Object.entries(data).forEach(([componentName, info]) => {
    const { name, summary, title, type } = info
    const itemFileName = info.fileName || filename
    const context: NotifySelectorContext = { componentName, fileName: itemFileName, info }
    const getRefSelector = (selector: string) => options.getRefSelector(selector, context)

    // 接口
    normalizeDatasourceEntries(info.datasource).forEach(({ bind, api, desc }) => {
      services.push(addNotifyBinding({
        title: api,
        type: 'up',
        description: desc || '',
        refType: type,
      }, bind, itemFileName, getRefSelector))
    })

    // 事件
    normalizeEventEntries(info.events).forEach(({ bind, name: eventName, title, mermaid, relations }) => {
      const result: any = addNotifyBinding({
        title: eventName,
        mermaid: mermaid || '',
        description: title || '',
      }, bind, itemFileName, getRefSelector)
      const getRelationRefSelector = options.getRelationRefSelector
      if (relations && getRelationRefSelector) {
        result.relations = Object.entries(relations).flatMap(([name, { type }]) => {
          const refSelector = getRelationRefSelector(name, context)
          return refSelector ? [{ type, refSelector }] : []
        })
      }
      events.push(result)
    })

    // state
    normalizeStateEntries(info.state).forEach(({ bind, field, desc }) => {
      state.push(addNotifyBinding({ field, description: desc || '' }, bind, itemFileName, getRefSelector))
    })

    if (type !== 'app' && type !== 'application') {
      const refSelector = options.getDocRefSelector?.(context)
      if (refSelector) {
        docs.push({ refSelector, name, title, summary, type })
      }
    }
  })

  return {
    events,
    services,
    state,
    store: state,
    docs
  }
}

