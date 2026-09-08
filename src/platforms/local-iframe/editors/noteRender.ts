import { getElementCodeLocation, getClosestDomLoc } from '../../../helpers/dom'
import { formatDisplayClassName, getElementClassNames } from './style'
import { executeLocalShellCommand, getCurrentBranch, AUDIT_REVIEW_ROOT } from '../sandbox'
import context from '../../../mix/context'

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function buildCommentKey(files: { jsx: string }, codeLine: { start: number; end: number }): string {
  const codeLineValue = `"codeLine":{"start":${codeLine.start},"end":${codeLine.end}}`
  return `[data-loc*='${escapeCssAttributeValue(files.jsx)}']` + `[data-loc*='${escapeCssAttributeValue(codeLineValue)}']`
}

function parseCommentMap(content: string): Record<string, any[]> {
  if (!content.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any[]>
    }
  } catch (error) {
    console.warn('[noteRender] failed to parse comment.json', error)
  }

  return {}
}

async function getCommentPath(): Promise<string | undefined> {
  const branch = await getCurrentBranch().catch(() => undefined)
  return branch ? `${AUDIT_REVIEW_ROOT}/${branch}/comment/comment.json` : undefined
}

let comment: any = null

async function getCommentMap(): Promise<Record<string, any[]>> {
  if (comment) {
    return comment
  }

  const commentPath = await getCommentPath()
  if (!commentPath) {
    return {}
  }

  const commentResult = await executeLocalShellCommand(`if [ -f "$COMMENT_PATH" ]; then cat "$COMMENT_PATH"; fi`, {
    env: {
      COMMENT_PATH: commentPath,
    },
  })

  comment = parseCommentMap(commentResult.stdout)
  return comment
}

async function saveCommentMap(commentPath: string, commentMap: Record<string, any[]>): Promise<void> {
  await executeLocalShellCommand(`mkdir -p "$(dirname "$COMMENT_PATH")" && printf '%s' "$COMMENT_JSON" > "$COMMENT_PATH"`, {
    env: {
      COMMENT_PATH: commentPath,
      COMMENT_JSON: JSON.stringify(commentMap, null, 2),
    },
  })
}

export default {
  title: '',
  type: 'noteRender',
  value: {
    async get(params) {
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return null
      }
      const { files, codeLine } = loc
      const key = buildCommentKey(files, codeLine)

      const commentMap = await getCommentMap()

      if (!commentMap[key]) {
        commentMap[key] = []
      }

      return commentMap[key]
    },
    async set(params, value) {
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return null
      }
      const { files, codeLine } = loc
      const key = buildCommentKey(files, codeLine)
      const commentMap = await getCommentMap()
      commentMap[key] = value
      const commentPath = await getCommentPath()
      if (!commentPath) {
        return null
      }

      await saveCommentMap(commentPath, commentMap)

      context.component?.actions.notifyChanged("_noteRender", 'update', {
        comments: Object.entries(comment)
          .filter(([key, value]: any) => {
            return value?.length
          })
          .map(([key, value]: any) => {
            const operator = value[0].operator
            return {
              refSelector: key,
              author: {
                name: operator?.name || operator?.userName || operator?.email || '-'
              }
            }
          }),
        events: [],
        services: [],
        store: []
      })
    }
  }
}
