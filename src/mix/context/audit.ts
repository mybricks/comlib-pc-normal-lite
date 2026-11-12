import type { transformNewFormatForNotifyChanged } from "../../utils/ai-code/md/transformForNotifyChanged"
import { escapeCssAttributeValue } from "../../helpers/dom"
import type { DomLoc } from "../../helpers/dom"

type AuditValue = ReturnType<typeof transformNewFormatForNotifyChanged>
type AiDoc = { createTime: number; content: string }
type AuditResult = Partial<Omit<AuditValue, 'docs'> & { jsDoc: AuditValue['docs'][number]; aiDoc: AiDoc }>

export default class Audit {

  tsxToValueMap = new Map<string, AuditValue>()

  constructor(private context) {
    
  }

  set(params: {
    tsx: string
    value: ReturnType<typeof transformNewFormatForNotifyChanged>
  }) {
    this.tsxToValueMap.set(params.tsx, params.value)
  }

  get(params: {
    tsx: string,
    loc?: string | DomLoc,
    parentLoc?: string | DomLoc | null,
    widgetName?: string | null,
    type: 'canvas' | 'dom',
    valueKeys: string[] // events services state store jsDoc aiDoc
  }): AuditResult {
    const value = this.tsxToValueMap.get(params.tsx)
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
    const matches = (item: { location?: { fileName: string; startLine: number; endLine: number }; refSelector?: string }) => {
      if (!locations.length) return false
      if (item.location) {
        return locations.some(location => item.location!.fileName === location.files.jsx
          && item.location!.startLine === location.codeLine.start
          && item.location!.endLine === location.codeLine.end)
      }
      return false
    }

    for (const key of params.valueKeys) {
      if (key === 'jsDoc') {
        const docs = value?.docs ?? []
        result.jsDoc = params.type === 'dom'
          ? params.widgetName
            ? docs.find(doc => doc.refSelector.includes(`[data-widget-name="${params.widgetName}"]`))
            : undefined
          : docs[0]
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
      const items = value?.[key] ?? []
      Object.assign(result, { [key]: params.type === 'dom' ? items.filter(matches) : items })
    }
    return result
  }
}
