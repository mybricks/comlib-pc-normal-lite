import type { transformNewFormatForNotifyChanged } from "../../utils/ai-code/md/transformForNotifyChanged"
import { escapeCssAttributeValue } from "../../helpers/dom"
import type { DomLoc } from "../../helpers/dom"

type AuditValue = ReturnType<typeof transformNewFormatForNotifyChanged>
type AiDoc = { createTime: number; content: string }
type AuditResult = Partial<AuditValue & { aiDoc: AiDoc }>

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
    type: 'canvas' | 'dom',
    valueKeys: string[] // events services state store docs aiDoc
  }): AuditResult {
    const value = this.tsxToValueMap.get(params.tsx)
    const result: AuditResult = {}
    let loc: DomLoc | undefined
    if (params.type === 'dom') {
      try {
        loc = typeof params.loc === 'string' ? JSON.parse(params.loc) : params.loc
      } catch {
        // 无效的 data-loc 不应导致整个审计查询失败。
      }
    }
    const hasLocation = !!loc?.files?.jsx && Number.isInteger(loc?.codeLine?.start)
      && Number.isInteger(loc?.codeLine?.end)
    let elements: Element[] | undefined

    const matches = (item: { location?: { fileName: string; startLine: number; endLine: number }; refSelector?: string }) => {
      if (!hasLocation) return false
      if (item.location) {
        return item.location.fileName === loc!.files.jsx
          && item.location.startLine === loc!.codeLine.start
          && item.location.endLine === loc!.codeLine.end
      }
      if (!item.refSelector) return false

      // 兼容只有 selector 的绑定；从设计器中找到 loc 对应的元素再匹配。
      if (!elements) {
        const root = typeof document === 'undefined'
          ? undefined
          : document.querySelector('#_mybricks-geo-webview_')?.shadowRoot
        elements = Array.from(root?.querySelectorAll('[data-loc]') ?? []).filter(element => {
          try {
            const elementLoc = JSON.parse(element.getAttribute('data-loc') || '') as DomLoc
            return elementLoc.files?.jsx === loc!.files.jsx
              && elementLoc.codeLine?.start === loc!.codeLine.start
              && elementLoc.codeLine?.end === loc!.codeLine.end
          } catch {
            return false
          }
        })
      }
      try {
        return elements.some(element => element.matches(item.refSelector!))
      } catch {
        return false
      }
    }

    for (const key of params.valueKeys) {
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
      if (key !== 'events' && key !== 'services' && key !== 'state' && key !== 'store' && key !== 'docs') continue
      const items = value?.[key] ?? []
      Object.assign(result, { [key]: params.type === 'dom' ? items.filter(matches) : items })
    }
    return result
  }
}
