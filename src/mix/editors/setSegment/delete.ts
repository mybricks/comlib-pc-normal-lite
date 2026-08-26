import context, { config } from '../../context'
import { undoRedoManager } from '../undoRedo'
import { randomUUID } from '../../utils/uuid'
import { buildElementDeleteChipData, getElementLabel } from './elementChip'
import { getShadowRoot } from '../../../helpers/designer'
import {
  createDOMSourceLocationSnapshot,
  restoreDOMSourceLocationSnapshot,
  shiftDOMSourceLocationsAfterReplacement,
} from './sourceLocation'

const LOCAL_FILE_DELETE_ENDPOINT = '/lingchuang/api/delete'

const getDeleteShadowRoot = () => {
  const shadowRoot = getShadowRoot()

  if (config.getFrontendMode() === 'local-iframe') {
    return shadowRoot.getElementById('local-iframe')!.contentDocument
  }

  return shadowRoot
}

type LocalFileDelete = {
  fileName: string
  start: number
  end: number
  content: string
  expectedContent?: string
}

const updateLocalFileAfterDelete = async ({ expectedContent, ...update }: LocalFileDelete) => {
  const response = await fetch(LOCAL_FILE_DELETE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...update,
      ...(expectedContent === undefined ? {} : { expectedContent }),
    }),
  })

  if (!response.ok) {
    throw new Error(`Local file delete failed: ${response.status}`)
  }

  const result = await response.json()
  if (typeof result?.replacedContent !== 'string') {
    throw new Error('Local file delete returned an invalid response')
  }

  return result.replacedContent as string
}

const createDeletePlaceholder = (length: number, preserveSourceLength = true) => {
  const placeholder = '<></>'
  if (!preserveSourceLength) return placeholder

  // 不能截断空 Fragment：<i/> 只有 4 个字符，截成 <></ 会产生无法编译的 JSX。
  // 极短节点允许源码增长 1 个字符，并在下方同步后续绝对偏移。
  return placeholder.length >= length ? placeholder : placeholder + ' '.repeat(length - placeholder.length)
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

const runDeleteByLocalServer = async ({
  fromEle,
  fileName,
  start,
  end,
  placeholder,
  shadowRoot,
  sourceLocationSnapshot,
  parent,
  nextSibling,
  fromLabel,
  actionId,
}) => {
  let previousValue: string
  try {
    // 本地项目源码不在组件 data 中，由 playground 服务完成首次替换。
    previousValue = await updateLocalFileAfterDelete({ fileName, start, end, content: placeholder })
  } catch {
    return runDeleteByAI(fromEle)
  }

  let isInitialExecution = true
  const updateLocalFile = (update: LocalFileDelete) => {
    void updateLocalFileAfterDelete(update).catch((error) => {
      console.error('[local-iframe] delete element failed', error)
    })
  }

  undoRedoManager.executeBranch({
    execute() {
      if (isInitialExecution) {
        isInitialExecution = false
      } else {
        updateLocalFile({
          fileName,
          start,
          end: start + previousValue.length,
          content: placeholder,
          expectedContent: previousValue,
        })
      }
      shiftDOMSourceLocationsAfterReplacement(shadowRoot, fileName, {
        start,
        end,
        newLength: placeholder.length,
      })
      fromEle.remove()
      context.component!.actions.addUserAction({
        id: actionId,
        type: 'delete',
        title: `删除 ${fromLabel}`,
        refElement: fromEle,
      })
    },
    undo() {
      updateLocalFile({
        fileName,
        start,
        end: start + placeholder.length,
        content: previousValue,
        expectedContent: placeholder,
      })
      if (parent) {
        parent.insertBefore(fromEle, nextSibling?.parentNode === parent ? nextSibling : null)
      }
      restoreDOMSourceLocationSnapshot(sourceLocationSnapshot)
      context.component!.actions.removeUserAction(actionId)
    },
  })

  return { type: 'success', actionId }
}

const runDelete = (options) => {
  const { fromEle } = options
  const loc = fromEle.dataset.loc

  if (!loc) {
    return runDeleteByAI(fromEle)
  } else {
    const shadowRoot = getDeleteShadowRoot()
    const elements = shadowRoot.querySelectorAll(`[data-loc='${loc}']`)
    if (elements.length > 1) {
      // 有多个，走AI
      return runDeleteByAI(fromEle)
    } else {
      const { files, jsx } = JSON.parse(loc)
      const start = jsx?.start
      const end = jsx?.end

      if (config.getFrontendMode() === 'local-iframe') {
        if (!files?.jsx || typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start) {
          return runDeleteByAI(fromEle)
        }

        // local-iframe 会由本地服务写文件并触发 HMR，无需用空格维持源码偏移。
        const placeholder = createDeletePlaceholder(end - start, false)
        const parent = fromEle.parentNode
        const nextSibling = fromEle.nextSibling

        return runDeleteByLocalServer({
          fromEle,
          fileName: files.jsx,
          start,
          end,
          placeholder,
          shadowRoot,
          sourceLocationSnapshot: createDOMSourceLocationSnapshot(shadowRoot, files.jsx),
          parent,
          nextSibling,
          fromLabel: getElementLabel(fromEle, '节点1'),
          actionId: randomUUID(),
        })
      }

      const file = context.component!.params!.data!.files.find((file) => file.fileName === files.jsx)
      const source = file ? decodeURIComponent(file.source) : ''

      if (!file || typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start || end > source.length) {
        return runDeleteByAI(fromEle)
      }

      const placeholder = createDeletePlaceholder(end - start)
      const newSource = source.slice(0, start) + placeholder + source.slice(end)
      const sourceLocationSnapshot = createDOMSourceLocationSnapshot(shadowRoot, files.jsx)
      const parent = fromEle.parentNode
      const nextSibling = fromEle.nextSibling
      const fromLabel = getElementLabel(fromEle, '节点1')
      const actionId = randomUUID()

      undoRedoManager.executeBranch({
        execute() {
          context.updateFile({ fileName: files.jsx, content: newSource, type: undefined, noUpdateFileSystem: true })
          shiftDOMSourceLocationsAfterReplacement(shadowRoot, files.jsx, {
            start,
            end,
            newLength: placeholder.length,
          })
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
          restoreDOMSourceLocationSnapshot(sourceLocationSnapshot)
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
