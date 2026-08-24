import { parsemd, SummaryBlock } from "./index";

const transformForNotifyChanged = (compiled: ReturnType<typeof parsemd>) => {
  const events: any = []
  const services: Array<{ title: string; refSelector: string; description: string; type: 'up' }>= []
  const store: Array<{ refSelector:string, field:string, description:string }> = []

  /**
   * 递归处理每个 block：
   * - ancestorSelector: 祖先链拼接的 selector（如 "[data-widget-name="A"] [data-widget-name="B"]"）
   *   当前块有数据时，在祖先基础上追加自身，最终生成完整的父子 selector 前缀
   */
  const processBlock = (componentName: string, info: SummaryBlock, ancestorSelector: string | null = null) => {
    // 顶层为分组/页面，跳过自身 selector 构建，直接递归子块
    if (ancestorSelector === null && info.children && !info.datasource && !info.events && !info.store) {
      Object.entries(info.children).forEach(([childName, childInfo]) => {
        processBlock(childName, childInfo, null)
      })
      return
    }

    const selfSelector = `[data-widget-name="${componentName}"]`
    const widgetSelector = ancestorSelector ? `${ancestorSelector} ${selfSelector}` : selfSelector

    // 接口
    if (info.datasource) {
      Object.entries(info.datasource).forEach(([classname, value]) => {
        Object.entries(value).forEach(([api, { desc }]) => {
          const classSelector = `[data-zone-classnames*="${classname}"]`
          services.push({
            title: api,
            type: 'up',
            refSelector: classname === 'root' ? widgetSelector : `${widgetSelector}${classSelector}:not([data-wrap-container]), ${widgetSelector} ${classSelector}:not([data-wrap-container])`,
            description: desc || ""
          })
        })
      })
    }

    // 事件
    if (Array.isArray(info.events)) {
      info.events.forEach((event) => {
        const { id, handlers } = event
        const classSelector = `[data-zone-classnames*="${id}"]`

        handlers.forEach(({ handler, title, mermaid, relations }) => {
          const refSelector = `${widgetSelector}${classSelector}:not([data-wrap-container]), ${widgetSelector} ${classSelector}:not([data-wrap-container])`
          const result: any = {
            refSelector,
            title: handler,
            mermaid,
            description: title
          }

          if (relations && relations.length > 0) {
            result.relations = relations.map(r => ({
              type: r.type,
              refSelector: `[data-widget-name="${r.name}"]:not([data-wrap-container])`,
            }))
          }

          events.push(result)
        })
      })
    }

    // store
    if (info.store) {
      Object.entries(info.store).forEach(([classname, value]) => {
        value.forEach(({ desc, field }) => {
          const classSelector = `[data-zone-classnames*="${classname}"]`

          store.push({
            field,
            refSelector: classname === 'root' ? widgetSelector : `${widgetSelector}${classSelector}:not([data-wrap-container]), ${widgetSelector} ${classSelector}:not([data-wrap-container])`,
            description: desc || ""
          })
        })
      })
    }

    // 递归处理子块，将当前完整 widgetSelector 作为祖先传递
    if (info.children) {
      Object.entries(info.children).forEach(([childName, childInfo]) => {
        processBlock(childName, childInfo, widgetSelector)
      })
    }
  }

  Object.entries(compiled).forEach(([componentName, info]) => {
    processBlock(componentName, info, null)
  })

  return {
    events,
    services,
    store
  }
}

export { transformForNotifyChanged }

// ─── New JSON format transformer ─────────────────────────────────────────────

/**
 * 给 refSelector 中每个子选择器追加 :not([data-wrap-container])，
 * 从而排除 wrapThirdPartyPlugin 注入的外层包裹 div（该 div 带有 data-wrap-container="true"）。
 */
function excludeWrapContainer(refSelector: string): string {
  return refSelector
    .split(',')
    .map(s => `${s.trim()}:not([data-wrap-container])`)
    .join(', ')
}

/**
 * 将 YAML 中的元素定位键转换为设计器当前可消费的 DOM selector。
 * 新 YAML 使用 .className / #id，也支持 ".parent .child" 这类组合 selector；
 * 旧 JSDoc 使用不带前缀的 className，继续兼容。
 */
function transformElementSelector(selector: string): string {
  const value = selector.trim()
  if (value.startsWith('.') || value.startsWith('#')) {
    return value.replace(/\.([A-Za-z_][\w-]*)/g, '[data-zone-classnames*="$1"]')
  }
  const className = value.startsWith('.') ? value.slice(1) : value
  return `[data-zone-classnames*="${className}"]`
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
  if (location) bindingResult.location = location
  return bindingResult
}

function createMainRefSelector(selector: string, fileName: string, componentName: string): string {
  const fileSelector = `[data-zone-filename="${fileName}"]`
  const widgetSelector = `[data-widget-name="${componentName}"]`
  const classSelector = transformElementSelector(selector)
  return excludeWrapContainer(
    selector === 'root'
      ? `${fileSelector}${widgetSelector}, ${fileSelector} ${widgetSelector}`
      : `${fileSelector}${widgetSelector}${classSelector}` +
        `, ${fileSelector}${widgetSelector} ${classSelector}` +
        `, ${fileSelector} ${widgetSelector}${classSelector}` +
        `, ${fileSelector} ${widgetSelector} ${classSelector}`,
  )
}

function createLocalIframeRefSelector(selector: string, fileName: string): string | undefined {
  if (selector === 'root') return undefined
  const fileSelector = `[data-loc*="${fileName}"]`
  const value = selector.trim()
  const classSelector = (value.startsWith('.') || value.startsWith('#'))
    ? value.replace(/\.([A-Za-z_][\w-]*)/g, '[class*="$1"]')
    : `[class*="${value}"]`
  return excludeWrapContainer(`${fileSelector}${classSelector}, ${fileSelector} ${classSelector}`)
}

/**
 * 将新版 JSON 格式的数据转换为 notifyChanged 所需的结构。
 *
 * 与旧版的差异：
 * - 新版数据为扁平结构，无页面节点/children 概念
 * - store 已变更为 state，结构改为 classname → fieldName → { desc }（去除了 storeFilePath 层级）
 * - events 结构改为 classname → eventName → { title, mermaid }；同一 selector/name
 *   的多个定义使用数组保留
 * - 通过传入文件名 (filename) 构建 refSelector 前缀，确保全局唯一定位
 *
 * @param data      新版 JSON 格式的组件数据
 * @param filename  当前文件名（如 "LoginPage"），写入 data-zone-filename 以保证唯一定位
 */
const transformNewFormatForNotifyChanged = (
  data: NewSummaryData,
  filename: string,
) => {
  const events: any[] = []
  const services: Array<{ title: string; description: string; type: 'up'; refType: string } & NotifyBinding> = []
  const state: Array<{ field: string; description: string } & NotifyBinding> = []
  const docs: Array<{ refSelector: string; name: string; title: string; summary: string; type: string }> = []

  Object.entries(data).forEach(([componentName, info]) => {
    const { name, summary, title, type } = info
    const itemFileName = info.fileName || filename
    const fileSelector = `[data-zone-filename="${itemFileName}"]`
    const widgetSelector = `[data-widget-name="${componentName}"]`
    const getRefSelector = (selector: string) => createMainRefSelector(selector, itemFileName, componentName)

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
      if (relations) {
        result.relations = Object.entries(relations).map(([name, { type }]) => ({
          type,
          refSelector: `[data-widget-name="${name}"]:not([data-wrap-container])`,
        }))
      }
      events.push(result)
    })

    // state
    normalizeStateEntries(info.state).forEach(({ bind, field, desc }) => {
      state.push(addNotifyBinding({ field, description: desc || '' }, bind, itemFileName, getRefSelector))
    })

    if (type !== 'app' && type !== 'application') {
      // 当前仅处理组件
      docs.push({
        refSelector: excludeWrapContainer(`${fileSelector}${widgetSelector}, ${fileSelector} ${widgetSelector}`),

        name,
        title,
        summary,
        type
      })
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

const transformLocalIframeFormatForNotifyChanged = (
  data: NewSummaryData,
  filename: string,
) => {
  const events: any[] = []
  const services: Array<{ title: string; description: string; type: 'up'; refType: string } & NotifyBinding> = []
  const state: Array<{ field: string; description: string } & NotifyBinding> = []
  const docs: Array<{ refSelector: string; name: string; title: string; summary: string; type: string }> = []

  Object.entries(data).forEach(([, info]) => {
    const { type } = info
    const itemFileName = info.fileName || filename
    const getRefSelector = (selector: string) => createLocalIframeRefSelector(selector, itemFileName)

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
    normalizeEventEntries(info.events).forEach(({ bind, name, title, mermaid, relations }) => {
      const result = addNotifyBinding({
        title: name,
        mermaid: mermaid || '',
        description: title || '',
      }, bind, itemFileName, getRefSelector)
      if (relations) {
        // local iframe 当前不支持 relations 的 DOM selector，但保留 location/selector 事件信息。
      }
      events.push(result)
    })

    // state
    normalizeStateEntries(info.state).forEach(({ bind, field, desc }) => {
      state.push(addNotifyBinding({ field, description: desc || '' }, bind, itemFileName, getRefSelector))
    })

    if (type !== 'app' && type !== 'application') {
      // 当前仅处理组件
      // docs.push({
      //   refSelector: excludeWrapContainer(`${fileSelector}${widgetSelector}, ${fileSelector} ${widgetSelector}`),

      //   name,
      //   title,
      //   summary,
      //   type
      // })
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

export { transformNewFormatForNotifyChanged, transformLocalIframeFormatForNotifyChanged  }
