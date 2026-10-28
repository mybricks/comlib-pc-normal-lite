import context from '../../../../mix/context'
import { undoRedoManager } from '../../../../mix/editors/undoRedo'
import { randomUUID } from '../../../../mix/utils/uuid'
import { buildElementInsertAiRequest, getElementLabel } from '../../../../mix/editors/setSegment/elementChip'
import { createPreview } from '../../../../mix/editors/setSegment/insert'

type InsertCode = { import?: string; jsx: string }

interface Props {
  toEle: Node
  type: 'before' | 'after' | 'child'
  code: InsertCode | (() => InsertCode)
}

function createFallbackPreview(doc: Document) {
  const marker = doc.createElement('div')
  marker.textContent = '待插入内容'
  marker.style.cssText = 'display:inline-block;padding:8px 12px;border:1px dashed #1677ff;background:#e6f4ff;color:#0958d9;font:14px sans-serif;'
  return marker
}

export default function insert({ toEle, type, code: codeOption }: Props) {
  if (!toEle || !['before', 'after', 'child'].includes(type) || !codeOption) return
  if (!toEle.parentNode && !(type === 'child' && toEle.nodeType === 1)) return

  const code = typeof codeOption === 'function' ? codeOption() : codeOption
  if (!code?.jsx?.trim()) return

  console.log('code', code)

  const preview = createPreview(code)?.container ?? createFallbackPreview(toEle.ownerDocument ?? document)
  const actionId = randomUUID()
  const targetLabel = getElementLabel(toEle, '节点')
  const title = `在 ${targetLabel}${type === 'before' ? '前' : type === 'after' ? '后' : '内部'}插入内容`

  undoRedoManager.executeBranch({
    aiRequest: buildElementInsertAiRequest({
      ele: toEle,
      jsx: code.jsx,
      placement: type,
      importCode: code.import,
    }),
    execute() {
      if (type === 'child' && toEle.nodeType === 1) {
        toEle.appendChild(preview)
      } else {
        toEle.parentNode?.insertBefore(preview, type === 'after' ? toEle.nextSibling : toEle)
      }
      context.component?.actions.addUserAction({
        id: actionId,
        type: 'insert',
        title,
        refElement: preview,
      })
    },
    undo() {
      preview.remove()
      context.component?.actions.removeUserAction(actionId)
    },
  })

  return { type: 'success', actionId, refElement: preview }
}
