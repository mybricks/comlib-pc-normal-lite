import type { transformLocalIframeFormatForNotifyChanged } from '../sandbox/notifyChanged'
import type { DomLoc } from '../../../helpers/dom'
import type { Doc, DocMap } from './doc'

type AuditValue = ReturnType<typeof transformLocalIframeFormatForNotifyChanged>
type AuditResult = Partial<Omit<AuditValue, 'docs'> & {
  jsDoc: AuditValue['docs'][number]
  aiDoc: DocMap[string]
}>

function matchesSourceFile(fileName: string | undefined, jsx: string): boolean {
  return !!fileName && jsx.endsWith(fileName.startsWith('/') ? fileName : `/${fileName}`)
}

/** 本地页面以路由为 key，缓存 YAML graph 编译后的审计数据。 */
export class Audit {
  private pathToValueMap = new Map<string, AuditValue>()
  private doc?: Pick<Doc, 'get' | 'buildKey'>

  constructor(doc?: Pick<Doc, 'get' | 'buildKey'>) {
    this.doc = doc
  }

  set(params: { path: string; value: AuditValue }): void {
    this.pathToValueMap.set(params.path, params.value)
  }

  async get(params: {
    path?: string
    type?: 'canvas' | 'dom'
    loc?: string | DomLoc | null
    parentLoc?: string | DomLoc | null
    valueKeys: string[]
  }): Promise<AuditResult> {
    const value = params.path === undefined ? undefined : this.pathToValueMap.get(params.path)
    const result: AuditResult = {}
    const parseLoc = (input?: string | DomLoc | null): DomLoc | undefined => {
      if (params.type !== 'dom') return undefined
      try {
        const loc = typeof input === 'string' ? JSON.parse(input) : input
        return loc?.files?.jsx && Number.isInteger(loc?.codeLine?.start)
          && Number.isInteger(loc?.codeLine?.end) ? loc : undefined
      } catch {
        return undefined
      }
    }
    const loc = parseLoc(params.loc)
    const parentLoc = parseLoc(params.parentLoc)
    const locations = [loc, parentLoc].filter((item): item is DomLoc => !!item)
    for (const key of params.valueKeys) {
      if (key === 'jsDoc') {
        const jsx = (loc ?? parentLoc)?.files.jsx
        result.jsDoc = params.type === 'dom'
          ? value?.docs.find(doc => {
            // 本地文档的 refSelector 保存节点文件名，先还原属性值中的转义。
            const fileName = doc.refSelector.match(/\[data-loc\*="((?:\\.|[^"\\])*)"\]/)?.[1]
              ?.replace(/\\(["\\])/g, '$1')
            return !!jsx && matchesSourceFile(fileName, jsx)
          })
          : value?.docs[0]
      } else if (key === 'aiDoc') {
        if (params.type === 'dom') {
          result.aiDoc = loc && this.doc
            ? await this.doc.get(this.doc.buildKey(loc.files, loc.codeLine))
            : { createTime: Date.now(), content: '' }
        }
      } else if (key === 'events' || key === 'services' || key === 'state' || key === 'store') {
        const items = value?.[key] ?? []
        Object.assign(result, { [key]: params.type === 'dom'
          ? items.filter(item => locations.some(loc => matchesSourceFile(item.location?.fileName, loc.files.jsx)
            && item.location.startLine === loc.codeLine.start && item.location.endLine === loc.codeLine.end))
          : items })
      }
    }
    return result
  }

  clear(): void {
    this.pathToValueMap.clear()
  }
}
