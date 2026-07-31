import context from '../../context'
import { undoRedoManager } from '../undoRedo'
import { randomUUID } from '../../utils/uuid'
import { buildElementTextUpdateChipData, getElementLabel } from './elementChip'
import { getShadowRoot } from '../../../helpers/designer'

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
  const nextValue = content.split('\n').join('<br/>')

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

const updateText = (options) => {
  const { fromEle, content } = options
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

    const shadowRoot = getShadowRoot()
    const elements = shadowRoot.querySelectorAll(`[data-loc='${locValue}']`)
    if (elements.length > 1) {
      // 有多个相同 data-loc，直接修改会影响多个渲染实例，走 AI
      return runUpdateTextByAI(fromEle, content)
    }

    const loc = JSON.parse(locValue)
    const textloc = JSON.parse(zoneTextEditable)
    const fileName = loc.files?.jsx
    const file = context.component!.params!.data!.files.find((file) => file.fileName === fileName)
    const source = file ? decodeURIComponent(file.source) : ''
    const start = textloc.jsx?.start
    const end = textloc.jsx?.end

    if (!file || !fileName || typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start || end > source.length) {
      return runUpdateTextByAI(fromEle, content)
    }

    const nextValue = content.split('\n').join('<br/>')
    const newSource = source.slice(0, start) + nextValue + source.slice(end)
    const previousInnerHTML = fromEle.innerHTML
    const fromLabel = getElementLabel(fromEle, '节点1')
    const actionId = randomUUID()

    undoRedoManager.executeBranch({
      execute() {
        context.updateFile({ fileName, content: newSource, type: undefined, noUpdateFileSystem: true })
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
