import context from '../../../../mix/context'
import { undoRedoManager } from '../../../../mix/editors/undoRedo'
import { randomUUID } from '../../../../mix/utils/uuid'
import { buildElementDeleteAiRequest } from '../../../../mix/editors/setSegment/elementChip'
import { formatDisplayClassName } from '../style'

function buildLabel(ele: HTMLElement) {
  const rawClassNames = Array.from(ele.classList).filter(Boolean)
  const lastClassName = rawClassNames[rawClassNames.length - 1] ?? ''
  const labelTarget = lastClassName ? formatDisplayClassName(lastClassName) : ele.tagName.toLowerCase()
  return `删除 ${labelTarget}`
}

export default function ({ fromEle: ele }) {
  if (!ele) {
    return {
      type: 'success',
    }
  }

  const parent = ele.parentNode
  const nextSibling = ele.nextSibling
  const actionId = randomUUID()
  const label = buildLabel(ele)

  undoRedoManager.executeBranch({
    aiRequest: buildElementDeleteAiRequest({ ele }),
    execute() {
      ele.remove()
      context.component?.actions.addUserAction({
        id: actionId,
        type: 'delete',
        title: label,
        refElement: ele,
      })
    },
    undo() {
      if (parent) {
        parent.insertBefore(ele, nextSibling?.parentNode === parent ? nextSibling : null)
      }
      context.component?.actions.removeUserAction(actionId)
    },
  })

  return {
    type: 'success',
  }
}
