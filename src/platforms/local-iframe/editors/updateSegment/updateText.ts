import context from '../../../../mix/context'
import { undoRedoManager } from '../../../../mix/editors/undoRedo'
import { randomUUID } from '../../../../mix/utils/uuid'
import { buildElementTextUpdateAiRequest } from '../../../../mix/editors/setSegment/elementChip'
import { formatDisplayClassName } from '../style'

function buildLabel(ele: HTMLElement) {
  const rawClassNames = Array.from(ele.classList).filter(Boolean)
  const lastClassName = rawClassNames[rawClassNames.length - 1] ?? ''
  const labelTarget = lastClassName ? formatDisplayClassName(lastClassName) : ele.tagName.toLowerCase()
  return `修改 ${labelTarget} 内容`
}

export default function ({ fromEle: ele, content }) {
  if (!ele) {
    return {
      type: 'success',
    }
  }

  const nextHTML = typeof content === 'string' ? content : String(content ?? '')
  const previousHTML = ele.innerHTML

  if (previousHTML === nextHTML) {
    return {
      type: 'success',
    }
  }

  const actionId = randomUUID()
  const label = buildLabel(ele)

  undoRedoManager.executeBranch({
    aiRequest: buildElementTextUpdateAiRequest({
      ele,
      content: nextHTML,
    }),
    execute() {
      ele.innerHTML = nextHTML
      context.component?.actions.addUserAction({
        id: actionId,
        type: 'update-text',
        title: label,
        refElement: ele,
      })
    },
    undo() {
      ele.innerHTML = previousHTML
      context.component?.actions.removeUserAction(actionId)
    },
  })

  return {
    type: 'success',
  }
}
