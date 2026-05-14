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
