import context from '../../context'
import { undoRedoManager } from '../undoRedo'
import { randomUUID } from '../../utils/uuid'
import { buildElementDeleteChipData, getElementLabel } from './elementChip'
import { getShadowRoot } from '../../../helpers/designer'

const createDeletePlaceholder = (length: number) => {
  const placeholder = '<></>'
  return placeholder.length >= length ? placeholder.slice(0, length) : placeholder + ' '.repeat(length - placeholder.length)
}

const runDeleteByAI = (fromEle) => {
  const fromLabel = getElementLabel(fromEle, '节点1')
  const actionId = randomUUID()
  const chip = {
    id: randomUUID(),
    type: 'element-delete',
    label: `删除 ${fromLabel} `,
    data: buildElementDeleteChipData(fromEle, fromLabel),
  }

  const parent = fromEle.parentNode
  const nextSibling = fromEle.nextSibling

  undoRedoManager.executeBranch({
    aiRequest: {
      message: `[[chip:${chip.id}]]`,
      chips: [chip],
    },
    execute() {
      fromEle.remove()
      context.component!.actions.addUserAction({
        id: actionId,
        type: 'delete',
        title: `删除 ${fromLabel}`,
        refElement: fromEle,
      })
    },
    undo() {
      if (parent) {
        parent.insertBefore(fromEle, nextSibling?.parentNode === parent ? nextSibling : null)
      }
      context.component!.actions.removeUserAction(actionId)
    },
  })

  return { type: 'success' }
}

const runDelete = (options) => {
  const { fromEle } = options
  const loc = fromEle.dataset.loc

  if (!loc) {
    return runDeleteByAI(fromEle)
  } else {
    const shadowRoot = getShadowRoot()
    const elements = shadowRoot.querySelectorAll(`[data-loc='${loc}']`)
    if (elements.length > 1) {
      // 有多个，走AI
      return runDeleteByAI(fromEle)
    } else {
      const { files, jsx } = JSON.parse(loc)
      const file = context.component!.params!.data!.files.find((file) => file.fileName === files.jsx)
      const source = file ? decodeURIComponent(file.source) : ''
      const start = jsx?.start
      const end = jsx?.end

      if (!file || typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start || end > source.length) {
        return runDeleteByAI(fromEle)
      }

      const newSource = source.slice(0, start) + createDeletePlaceholder(end - start) + source.slice(end)
      const parent = fromEle.parentNode
      const nextSibling = fromEle.nextSibling
      const fromLabel = getElementLabel(fromEle, '节点1')
      const actionId = randomUUID()

      undoRedoManager.executeBranch({
        execute() {
          context.updateFile({ fileName: files.jsx, content: newSource, type: undefined, noUpdateFileSystem: true })
          fromEle.remove()
          context.component!.actions.addUserAction({
            id: actionId,
            type: 'delete',
            title: `删除 ${fromLabel}`,
            refElement: fromEle,
          })
        },
        undo() {
          context.updateFile({ fileName: files.jsx, content: source, type: undefined, noUpdateFileSystem: true })
          if (parent) {
            parent.insertBefore(fromEle, nextSibling?.parentNode === parent ? nextSibling : null)
          }
          context.component!.actions.removeUserAction(actionId)
        },
      })

      return {
        type: 'success',
        actionId,
      }
    }
  }
}

export default runDelete
