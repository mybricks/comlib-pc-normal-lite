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
            refSelector: classname === 'root' ? widgetSelector : `${widgetSelector}${classSelector}, ${widgetSelector} ${classSelector}`,
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
          const refSelector = `${widgetSelector}${classSelector}, ${widgetSelector} ${classSelector}`
          const result: any = {
            refSelector,
            title: handler,
            mermaid,
            description: title
          }

          if (relations && relations.length > 0) {
            result.relations = relations.map(r => ({
              type: r.type,
              refSelector: `[data-widget-name="${r.name}"]`,
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
            refSelector: classname === 'root' ? widgetSelector : `${widgetSelector}${classSelector}, ${widgetSelector} ${classSelector}`,
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

/** 新版 JSON 数据格式中每个组件/页面的结构 */
export type NewSummaryItem = {
  name: string
  title: string
  summary: string
  type: string
  /** store: classname → { storeFilePath → { fieldName → { desc } } } */
  store?: Record<string, Record<string, Record<string, { desc?: string }>>>
  /** events: classname → { eventName → { title, mermaid } } */
  events?: Record<string, Record<string, { title?: string; mermaid?: string; relations?: Record<string, any> }>>
  /** datasource: classname → { apiName → { desc } } */
  datasource?: Record<string, Record<string, { desc?: string }>>
}

/** 新版 JSON 数据格式：组件名 → 组件描述 */
export type NewSummaryData = Record<string, NewSummaryItem>

/**
 * 将新版 JSON 格式的数据转换为 notifyChanged 所需的结构。
 *
 * 与旧版的差异：
 * - 新版数据为扁平结构，无页面节点/children 概念
 * - store 结构改为 classname → storeFilePath → fieldName → { desc }
 * - events 结构改为 classname → eventName → { title, mermaid }（不再是 handler 数组）
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
  const services: Array<{ title: string; refSelector: string; description: string; type: 'up' }> = []
  const store: Array<{ refSelector: string; field: string; description: string }> = []
  const docs: Array<{ refSelector: string; name: string; title: string; summary: string; type: string }> = []

  const fileSelector = `[data-zone-filename="${filename}"]`

  Object.entries(data).forEach(([componentName, info]) => {
    const { name, summary, title, type } = info
    const widgetSelector = `${fileSelector} [data-widget-name="${componentName}"]`

    // 接口
    if (info.datasource) {
      Object.entries(info.datasource).forEach(([classname, apis]) => {
        Object.entries(apis).forEach(([apiName, { desc }]) => {
          const classSelector = `[data-zone-classnames*="${classname}"]`
          services.push({
            title: apiName,
            type: 'up',
            refSelector: classname === 'root'
              ? widgetSelector
              : `${widgetSelector}${classSelector}, ${widgetSelector} ${classSelector}`,
            description: desc || ''
          })
        })
      })
    }

    // 事件
    if (info.events) {
      Object.entries(info.events).forEach(([classname, handlers]) => {
        const classSelector = `[data-zone-classnames*="${classname}"]`
        const refSelector = `${widgetSelector}${classSelector}, ${widgetSelector} ${classSelector}`

        Object.entries(handlers).forEach(([eventName, { title, mermaid, relations }]) => {
          const result: any = {
            refSelector,
            title: eventName,
            mermaid: mermaid || '',
            description: title || ''
          }
          if (relations) {
            result.relations = Object.entries(relations).map(([name, { type }]) => {
              return {
                type,
                refSelector: `[data-widget-name="${name}"]`,
              }
            })
          }
          events.push(result)
        })
      })
    }

    // store
    if (info.store) {
      Object.entries(info.store).forEach(([classname, storeFiles]) => {
        const classSelector = `[data-zone-classnames*="${classname}"]`
        const refSelector = classname === 'root'
          ? widgetSelector
          : `${widgetSelector}${classSelector}, ${widgetSelector} ${classSelector}`

        Object.values(storeFiles).forEach((fields) => {
          Object.entries(fields).forEach(([field, { desc }]) => {
            store.push({
              field,
              refSelector,
              description: desc || ''
            })
          })
        })
      })
    }

    if (type !== 'app') {
      // 当前仅处理组件
      docs.push({
        refSelector: widgetSelector,
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
    store,
    docs
  }
}

export { transformNewFormatForNotifyChanged }
