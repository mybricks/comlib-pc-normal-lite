import { executeLocalShellCommand, getCurrentBranch, AUDIT_REVIEW_ROOT } from '../sandbox'
import { escapeCssAttributeValue } from '../../../helpers/dom'

export type DocMap = Record<string, {
  prd: string
}>

function parseDocMap(content: string): DocMap {
  if (!content.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as DocMap
    }
  } catch (error) {
    console.warn('[doc] failed to parse doc.json', error)
  }

  return {}
}

export class Doc {
  private doc: DocMap | null = null

  buildKey(files: { jsx: string }, codeLine: { start: number; end: number }): string {
    const codeLineValue = `"codeLine":{"start":${codeLine.start},"end":${codeLine.end}}`
    return `[data-loc*='${escapeCssAttributeValue(files.jsx)}']` + `[data-loc*='${escapeCssAttributeValue(codeLineValue)}']`
  }

  async getDocPath(): Promise<string | undefined> {
    const branch = await getCurrentBranch().catch(() => undefined)
    return branch ? `${AUDIT_REVIEW_ROOT}/${branch}/doc/doc.json` : undefined
  }

  async getMap(): Promise<DocMap> {
    if (this.doc) {
      return this.doc
    }

    const docPath = await this.getDocPath()
    if (!docPath) {
      this.doc = {}
      return this.doc
    }

    const docResult = await executeLocalShellCommand(`if [ -f "$COMMENT_PATH" ]; then cat "$COMMENT_PATH"; fi`, {
      env: {
        COMMENT_PATH: docPath,
      },
    })

    this.doc = parseDocMap(docResult.stdout)
    return this.doc
  }

  async get(key: string): Promise<string> {
    const docMap = await this.getMap()

    if (!docMap[key]) {
      docMap[key] = {
        prd: ''
      }
    }

    return docMap[key].prd
  }

  async set(key: string, value: string): Promise<boolean> {
    const docMap = await this.getMap()
    docMap[key] = {
      prd: value
    }

    const docPath = await this.getDocPath()
    if (!docPath) {
      return false
    }

    await this.saveMap(docPath, docMap)
    return true
  }

  private async saveMap(docPath: string, docMap: DocMap): Promise<void> {
    await executeLocalShellCommand(`mkdir -p "$(dirname "$COMMENT_PATH")" && printf '%s' "$COMMENT_JSON" > "$COMMENT_PATH" && git add "$COMMENT_PATH"`, {
      env: {
        COMMENT_PATH: docPath,
        COMMENT_JSON: JSON.stringify(docMap, null, 2),
      },
    })
  }
}
