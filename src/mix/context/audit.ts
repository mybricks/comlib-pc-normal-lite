import { transformNewFormatForNotifyChanged } from "./notifyChanged"
import type { NewSummaryData } from "../../helpers/ai-code/transformForNotifyChanged"
import { escapeCssAttributeValue } from "../../helpers/dom"
import type { DomLoc } from "../../helpers/dom"

type AuditValue = ReturnType<typeof transformNewFormatForNotifyChanged>
type AiDoc = { createTime: number; content: string }
type AuditResult = Partial<Omit<AuditValue, 'docs'> & { jsDoc: AuditValue['docs'][number]; aiDoc: AiDoc }>

export default class Audit {

  tsxToValueMap = new Map<string, AuditValue & { jsDocMap?: NewSummaryData; jsDocs: AuditValue['docs'] }>()

  constructor(private context) {
    
  }

  set(params: {
    tsx: string
    value: ReturnType<typeof transformNewFormatForNotifyChanged>
    jsDocMap?: NewSummaryData
  }) {
    this.tsxToValueMap.set(params.tsx, {
      ...params.value,
      jsDocMap: params.jsDocMap,
      jsDocs: params.jsDocMap ? transformNewFormatForNotifyChanged(params.jsDocMap, params.tsx).docs : [],
    })
  }

  get(params: {
    tsx: string,
    pageTsx?: string,
    loc?: string | DomLoc,
    parentLoc?: string | DomLoc | null,
    widgetName?: string | null,
    type: 'canvas' | 'dom',
    valueKeys: string[] // events services state store jsDoc aiDoc
  }): AuditResult {
    const value = this.tsxToValueMap.get(params.tsx)
    // Graph 按页面缓存，DOM 的源码文件可能只是页面引用的子组件。
    const values = params.type === 'dom'
      ? params.pageTsx
        ? [this.tsxToValueMap.get(params.pageTsx)].filter((item): item is NonNullable<typeof item> => !!item)
        : Array.from(this.tsxToValueMap.values())
      : value ? [value] : []
    const result: AuditResult = {}
    const parseLoc = (input?: string | DomLoc | null): DomLoc | undefined => {
      if (params.type !== 'dom') return undefined
      try {
        const parsed = typeof input === 'string' ? JSON.parse(input) : input
        return parsed?.files?.jsx && Number.isInteger(parsed?.codeLine?.start)
          && Number.isInteger(parsed?.codeLine?.end) ? parsed : undefined
      } catch {
        // 无效的定位信息不应导致整个审计查询失败。
        return undefined
      }
    }
    const loc = parseLoc(params.loc)
    const parentLoc = parseLoc(params.parentLoc)
    const locations = [loc, parentLoc].filter((item): item is DomLoc => !!item)
    const hasLocation = !!loc
    const matches = (item: { location?: { fileName: string; startLine: number; endLine: number } }, location: DomLoc) =>
      item.location?.fileName === location.files.jsx
      && item.location.startLine === location.codeLine.start
      && item.location.endLine === location.codeLine.end

    for (const key of params.valueKeys) {
      if (key === 'jsDoc') {
        if (params.type === 'canvas') {
          result.jsDoc = value?.docs[0] ?? value?.jsDocs[0]
          continue
        }
        // 组件文档只有文件和组件标记，没有元素行号；文件必须来自有效 loc。
        for (const location of locations) {
          const sourceValue = this.tsxToValueMap.get(location.files.jsx)
          const findDoc = (docs: AuditValue['docs']) => params.widgetName
            ? docs.find(doc => doc.refSelector.includes(`[data-zone-filename="${location.files.jsx}"]`)
              && doc.refSelector.includes(`[data-widget-name="${params.widgetName}"]`))
            : undefined
          result.jsDoc = findDoc(values.flatMap(item => item.docs))
            ?? findDoc(sourceValue?.docs ?? [])
            ?? findDoc(sourceValue?.jsDocs ?? [])
            ?? findDoc(values.flatMap(item => item.jsDocs))
          if (result.jsDoc) break
        }
        continue
      }
      if (key === 'aiDoc') {
        if (params.type === 'dom') {
          const emptyDoc = () => ({ createTime: Date.now(), content: '' })
          const data = this.context.component?.params?.data
          if (!hasLocation || !data) {
            result.aiDoc = emptyDoc()
            continue
          }
          const { files, codeLine } = loc!
          const docKey = `[data-loc*='${escapeCssAttributeValue(files.jsx)}']`
            + `[data-loc*='${escapeCssAttributeValue(`"codeLine":{"start":${codeLine.start},"end":${codeLine.end}}`)}']`
            + ':not([data-wrap-container])'
          const docs = data._docs || (data._docs = {})
          const doc = docs[docKey]
          if (typeof doc === 'string' && doc) {
            docs[docKey] = { createTime: Date.now(), content: doc }
          }
          result.aiDoc = docs[docKey] || emptyDoc()
        }
        continue
      }
      if (key !== 'events' && key !== 'services' && key !== 'state' && key !== 'store') continue
      // 同一 loc 出现在多个页面时，只取首个命中的页面，保留该元素的全部绑定。
      const items = params.type === 'dom'
        ? Array.from(new Set(locations.flatMap(location => {
          const matchedValue = values.find(value => value[key].some(item => matches(item, location)))
          return matchedValue?.[key].filter(item => matches(item, location)) ?? []
        })))
        : value?.[key] ?? []
      Object.assign(result, { [key]: items })
    }
    console.log('result', result)
    return result
  }
}
