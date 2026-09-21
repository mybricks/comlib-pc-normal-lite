import context from '../../../../mix/context'
import { undoRedoManager } from '../../../../mix/editors/undoRedo'
import { randomUUID } from '../../../../mix/utils/uuid'
import { buildElementMoveAiRequest } from '../../../../mix/editors/setSegment/elementChip'
import { isDOMMoveAllowed } from '../../../../helpers/dom'
import { formatDisplayClassName } from '../style'

function buildLabel(ele: HTMLElement) {
  const rawClassNames = Array.from(ele.classList).filter(Boolean)
  const lastClassName = rawClassNames[rawClassNames.length - 1] ?? ''
  const labelTarget = lastClassName ? formatDisplayClassName(lastClassName) : ele.tagName.toLowerCase()
  return `移动 ${labelTarget}`
}

interface Props {
  fromEle: HTMLElement
  toEle: HTMLElement
  type: 'before' | 'after' | 'child'
}

export default function ({ fromEle, toEle, type }: Props) {
  if (!fromEle || !toEle || fromEle === toEle || !fromEle.parentNode || !toEle.parentNode) {
    return {
      type: 'success',
    }
  }

  if (!isDOMMoveAllowed(fromEle, toEle, type)) {
    return
  }

  const parent = fromEle.parentNode
  const nextSibling = fromEle.nextSibling
  const actionId = randomUUID()
  const label = buildLabel(fromEle)

  undoRedoManager.executeBranch({
    aiRequest: buildElementMoveAiRequest({
      fromEle,
      toEle,
      placement: type,
    }),
    execute() {
      if (!toEle.parentNode) return
      if (type === 'child') {
        toEle.appendChild(fromEle)
      } else {
        toEle.parentNode.insertBefore(fromEle, type === 'before' ? toEle : toEle.nextSibling)
      }
      context.component?.actions.addUserAction({
        id: actionId,
        type: 'move',
        title: label,
        refElement: fromEle,
      })
    },
    undo() {
      if (parent) {
        parent.insertBefore(fromEle, nextSibling?.parentNode === parent ? nextSibling : null)
      }
      context.component?.actions.removeUserAction(actionId)
    },
  })

  return {
    type: 'success',
  }
}
