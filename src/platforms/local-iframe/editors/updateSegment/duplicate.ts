import context from '../../../../mix/context'
import { undoRedoManager } from '../../../../mix/editors/undoRedo'
import { randomUUID } from '../../../../mix/utils/uuid'
import { buildElementInsertAiRequest } from '../../../../mix/editors/setSegment/elementChip'
import { formatDisplayClassName } from '../style'

interface Props {
  fromEle: HTMLElement
}

function buildLabel(ele: HTMLElement) {
  const rawClassNames = Array.from(ele.classList).filter(Boolean)
  const lastClassName = rawClassNames[rawClassNames.length - 1] ?? ''
  const labelTarget = lastClassName ? formatDisplayClassName(lastClassName) : ele.tagName.toLowerCase()
  return `复制 ${labelTarget}`
}

export default function ({ fromEle }: Props) {
  if (!fromEle?.parentNode) {
    return {
      type: 'success',
    }
  }

  const clone = fromEle.cloneNode(true) as HTMLElement
  const actionId = randomUUID()
  const label = buildLabel(fromEle)

  undoRedoManager.executeBranch({
    aiRequest: buildElementInsertAiRequest({
      ele: fromEle,
      jsx: fromEle.outerHTML,
      placement: 'after',
    }),
    execute() {
      if (!fromEle.parentNode) return
      fromEle.parentNode.insertBefore(clone, fromEle.nextSibling)
      context.component?.actions.addUserAction({
        id: actionId,
        type: 'duplicate',
        title: label,
        refElement: clone,
      })
    },
    undo() {
      clone.remove()
      context.component?.actions.removeUserAction(actionId)
    },
  })

  return {
    type: 'success',
  }
}
