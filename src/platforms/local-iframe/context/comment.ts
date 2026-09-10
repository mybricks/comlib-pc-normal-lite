import { executeLocalShellCommand, getCurrentBranch, AUDIT_REVIEW_ROOT } from '../sandbox'
import context from '../../../mix/context'

export type CommentMap = Record<string, any[]>

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function parseCommentMap(content: string): CommentMap {
  if (!content.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CommentMap
    }
  } catch (error) {
    console.warn('[comment] failed to parse comment.json', error)
  }

  return {}
}

export class Comment {
  private comment: CommentMap | null = null

  constructor() {
    context.events.on('componentReady', () => {
      this.notifyChanged()
    }, false)
    void this.init()
  }

  private async init(): Promise<void> {
    try {
      await this.getMap()
    } catch (error) {
      console.warn('[comment] failed to initialize comment map', error)
    }

    this.notifyChanged()
  }

  buildKey(files: { jsx: string }, codeLine: { start: number; end: number }): string {
    const codeLineValue = `"codeLine":{"start":${codeLine.start},"end":${codeLine.end}}`
    return `[data-loc*='${escapeCssAttributeValue(files.jsx)}']` + `[data-loc*='${escapeCssAttributeValue(codeLineValue)}']`
  }

  async getCommentPath(): Promise<string | undefined> {
    const branch = await getCurrentBranch().catch(() => undefined)
    return branch ? `${AUDIT_REVIEW_ROOT}/${branch}/comment/comment.json` : undefined
  }

  async getMap(): Promise<CommentMap> {
    if (this.comment) {
      return this.comment
    }

    const commentPath = await this.getCommentPath()
    if (!commentPath) {
      this.comment = {}
      return this.comment
    }

    const commentResult = await executeLocalShellCommand(`if [ -f "$COMMENT_PATH" ]; then cat "$COMMENT_PATH"; fi`, {
      env: {
        COMMENT_PATH: commentPath,
      },
    })

    this.comment = parseCommentMap(commentResult.stdout)
    return this.comment
  }

  async get(key: string): Promise<any[]> {
    const commentMap = await this.getMap()

    if (!commentMap[key]) {
      commentMap[key] = []
    }

    return commentMap[key]
  }

  async set(key: string, value: any[]): Promise<boolean> {
    const commentMap = await this.getMap()
    commentMap[key] = value

    const commentPath = await this.getCommentPath()
    if (!commentPath) {
      return false
    }

    await this.saveMap(commentPath, commentMap)
    return true
  }

  getNotifyChangedValue() {
    return {
      comments: Object.entries(this.comment || {})
        .filter(([, value]: any) => {
          return value?.length
        })
        .map(([key, value]: any) => {
          return {
            refSelector: key,
            ...value[0],
            type: value.find(({ type }) => type === 'todo') ? 'todo' : 'default'
          }
        }),
      events: [],
      services: [],
      store: []
    }
  }

  notifyChanged(): void {
    context.component?.actions.notifyChanged("_noteRender", 'update', this.getNotifyChangedValue())
  }

  private async saveMap(commentPath: string, commentMap: CommentMap): Promise<void> {
    await executeLocalShellCommand(`mkdir -p "$(dirname "$COMMENT_PATH")" && printf '%s' "$COMMENT_JSON" > "$COMMENT_PATH" && git add "$COMMENT_PATH"`, {
      env: {
        COMMENT_PATH: commentPath,
        COMMENT_JSON: JSON.stringify(commentMap, null, 2),
      },
    })
  }
}
