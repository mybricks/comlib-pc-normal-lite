import context, { config } from '../../context'
import { undoRedoManager } from '../undoRedo'
import { randomUUID } from '../../utils/uuid'
import { buildElementTextUpdateChipData, getElementLabel } from './elementChip'
import { getShadowRoot } from '../../../helpers/designer'
import {
  createDOMSourceLocationSnapshot,
  restoreDOMSourceLocationSnapshot,
  shiftDOMSourceLocationsAfterReplacement,
} from './sourceLocation'

const toSafeJSXText = (content: string) => {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/{/g, '&#123;')
    .replace(/}/g, '&#125;')
    .split('\n')
    .join('<br/>')
}

const LOCAL_FILE_TEXT_UPDATE_ENDPOINT = '/__lingchuang-local-file/text'

const getUpdateTextShadowRoot = () => {
  const shadowRoot = getShadowRoot()

  if (config.getFrontendMode() === 'local-iframe') {
    return shadowRoot.getElementById('local-iframe')!.contentDocument
  }

  return shadowRoot
}

type LocalTextUpdate = {
  fileName: string
  start: number
  end: number
  content: string
  expectedContent?: string
}

const updateLocalFileText = async ({ expectedContent, ...update }: LocalTextUpdate) => {
  const response = await fetch(LOCAL_FILE_TEXT_UPDATE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...update,
      ...(expectedContent === undefined ? {} : { expectedContent }),
    }),
  })

  if (!response.ok) {
    throw new Error(`Local file update failed: ${response.status}`)
  }

  const result = await response.json()
  if (typeof result?.replacedContent !== 'string') {
    throw new Error('Local file update returned an invalid response')
  }

  return result.replacedContent as string
}

const runUpdateTextByAI = (fromEle, content: string) => {
  const fromLabel = getElementLabel(fromEle, '节点1')
  const actionId = randomUUID()
  const chip = {
    id: randomUUID(),
    type: 'element-text-update',
    label: `修改 ${fromLabel} 文案`,
    data: buildElementTextUpdateChipData(fromEle, content, fromLabel),
  }

  const previousInnerHTML = fromEle.innerHTML
  const nextValue = toSafeJSXText(content)

  undoRedoManager.executeBranch({
    aiRequest: {
      message: `[[chip:${chip.id}]]`,
      chips: [chip],
    },
    execute() {
      // AI 尚未改写源码，先在画布上显示用户输入的预期结果。
      fromEle.innerHTML = nextValue
      context.component!.actions.addUserAction({
        id: actionId,
        type: 'update-text',
        title: `修改 ${fromLabel} 文案`,
        refElement: fromEle,
      })
    },
    undo() {
      fromEle.innerHTML = previousInnerHTML
      context.component!.actions.removeUserAction(actionId)
    },
  })

  return { type: 'success' }
}

const runUpdateTextByLocalServer = async ({
  fromEle,
  content,
  fileName,
  start,
  end,
  nextValue,
  previousInnerHTML,
  shadowRoot,
  sourceLocationSnapshot,
  fromLabel,
  actionId,
}) => {
  let previousValue: string
  try {
    // 本地项目的源码不在组件 data 中，由 playground 服务读取并完成首次替换。
    previousValue = await updateLocalFileText({ fileName, start, end, content: nextValue })
  } catch {
    return runUpdateTextByAI(fromEle, content)
  }

  let isInitialExecution = true
  const updateLocalFile = (update: LocalTextUpdate) => {
    void updateLocalFileText(update).catch((error) => {
      console.error('[local-iframe] update text failed', error)
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
          content: nextValue,
          expectedContent: previousValue,
        })
      }
      shiftDOMSourceLocationsAfterReplacement(shadowRoot, fileName, {
        start,
        end,
        newLength: nextValue.length,
      })
      fromEle.innerHTML = nextValue
      context.component!.actions.addUserAction({
        id: actionId,
        type: 'update-text',
        title: `修改 ${fromLabel} 文案`,
        refElement: fromEle,
      })
    },
    undo() {
      updateLocalFile({
        fileName,
        start,
        end: start + nextValue.length,
        content: previousValue,
        expectedContent: nextValue,
      })
      restoreDOMSourceLocationSnapshot(sourceLocationSnapshot)
      fromEle.innerHTML = previousInnerHTML
      context.component!.actions.removeUserAction(actionId)
    },
  })

  return { type: 'success', actionId }
}

const updateText = (options) => {
  const { fromEle, content } = options
  console.log('updateText', options)
  if (!content.trim()) {
    // 不允许空字符
    return
  }

  const zoneTextEditable = fromEle.dataset['zoneTextEditable']

  if (!zoneTextEditable) {
    // 没有 data-zone-text-editable 属性，添加到对话框
    return runUpdateTextByAI(fromEle, content)
  }

  try {
    const locValue = fromEle.dataset.loc
    if (!locValue) {
      return runUpdateTextByAI(fromEle, content)
    }

    const shadowRoot = getUpdateTextShadowRoot()
    console.log(123, shadowRoot)
    const elements = shadowRoot.querySelectorAll(`[data-loc='${locValue}']`)
    if (elements.length > 1) {
      // 有多个相同 data-loc，直接修改会影响多个渲染实例，走 AI
      return runUpdateTextByAI(fromEle, content)
    }

    const loc = JSON.parse(locValue)
    const textloc = JSON.parse(zoneTextEditable)
    const fileName = loc.files?.jsx
    const start = textloc.jsx?.start
    const end = textloc.jsx?.end

    if (!fileName || typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start) {
      return runUpdateTextByAI(fromEle, content)
    }

    const nextValue = toSafeJSXText(content)
    const previousInnerHTML = fromEle.innerHTML

    if (config.getFrontendMode() === 'local-iframe') {
      return runUpdateTextByLocalServer({
        fromEle,
        content,
        fileName,
        start,
        end,
        nextValue,
        previousInnerHTML,
        shadowRoot,
        sourceLocationSnapshot: createDOMSourceLocationSnapshot(shadowRoot, fileName),
        fromLabel: getElementLabel(fromEle, '节点1'),
        actionId: randomUUID(),
      })
    }

    const file = context.component!.params!.data!.files.find((file) => file.fileName === fileName)
    const source = file ? decodeURIComponent(file.source) : ''
    if (!file || end > source.length) {
      return runUpdateTextByAI(fromEle, content)
    }

    const newSource = source.slice(0, start) + nextValue + source.slice(end)
    // noUpdateFileSystem 保留当前 DOM；后续节点仍会引用原始绝对偏移，先保留快照以支持撤销。
    const sourceLocationSnapshot = createDOMSourceLocationSnapshot(shadowRoot, fileName)
    const fromLabel = getElementLabel(fromEle, '节点1')
    const actionId = randomUUID()

    undoRedoManager.executeBranch({
      execute() {
        context.updateFile({ fileName, content: newSource, type: undefined, noUpdateFileSystem: true })
        shiftDOMSourceLocationsAfterReplacement(shadowRoot, fileName, {
          start,
          end,
          newLength: nextValue.length,
        })
        // noUpdateFileSystem 不会触发重新渲染，画布内容需要立即同步。
        fromEle.innerHTML = nextValue
        context.component!.actions.addUserAction({
          id: actionId,
          type: 'update-text',
          title: `修改 ${fromLabel} 文案`,
          refElement: fromEle,
        })
      },
      undo() {
        context.updateFile({ fileName, content: source, type: undefined, noUpdateFileSystem: true })
        restoreDOMSourceLocationSnapshot(sourceLocationSnapshot)
        fromEle.innerHTML = previousInnerHTML
        context.component!.actions.removeUserAction(actionId)
      },
    })

    return {
      type: 'success',
      actionId,
    }
  } catch (e) {
    return runUpdateTextByAI(fromEle, content)
  }
}

export default updateText
