import context from '../../context'
import { undoRedoManager } from '../undoRedo'
import { randomUUID } from '../../utils/uuid'
import { buildElementDeleteChipData, getElementLabel } from './elementChip'
import { getShadowRoot } from '../../../helpers/designer'

const createDeletePlaceholder = (length: number) => {
  const placeholder = '<></>'
  return placeholder.length >= length ? placeholder.slice(0, length) : placeholder + ' '.repeat(length - placeholder.length)
}

const sendDeleteToAI = (fromEle) => {
  const fromLabel = getElementLabel(fromEle, '节点1')
  const chip = {
    id: randomUUID(),
    type: 'element-delete',
    label: `删除 ${fromLabel} `,
    data: buildElementDeleteChipData(fromEle, fromLabel),
  }

  return {
    type: 'promise',
    message: `[[chip:${chip.id}]]`,
    chips: [chip]
  }
}

const runDelete = (options) => {
  const { fromEle } = options
  const loc = fromEle.dataset.loc

  if (!loc) {
    return sendDeleteToAI(fromEle)
  } else {
    const shadowRoot = getShadowRoot()
    const elements = shadowRoot.querySelectorAll(`[data-loc='${loc}']`)
    if (elements.length > 1) {
      // 有多个，走AI
      return sendDeleteToAI(fromEle)
    } else {
      const { files, jsx } = JSON.parse(loc)
      const file = context.component!.params!.data!.files.find((file) => file.fileName === files.jsx)
      const source = file ? decodeURIComponent(file.source) : ''
      const start = jsx?.start
      const end = jsx?.end

      if (!file || typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start || end > source.length) {
        return sendDeleteToAI(fromEle)
      }

      const newSource = source.slice(0, start) + createDeletePlaceholder(end - start) + source.slice(end)

      undoRedoManager.execute({
        execute() {
          context.updateFile({ fileName: files.jsx, content: newSource, type: undefined, noUpdateFileSystem: true })
          context.saveManualVersion([files.jsx],)
        },
        undo() {
          context.updateFile({ fileName: files.jsx, content: source, type: undefined, noUpdateFileSystem: true })
          context.saveManualVersion([files.jsx])
        },
      })

      return {
        type: 'success'
      }
    }
  }
}

export default runDelete
