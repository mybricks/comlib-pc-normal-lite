import context from '../../../../mix/context'
import { undoRedoManager } from '../../../../mix/editors/undoRedo'
import { randomUUID } from '../../../../mix/utils/uuid'
import { getElementCodeLocation } from '../../../../helpers/dom'
import { formatDisplayClassName, getElementClassNames } from '../style'

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
  const chipId = randomUUID(8)
  const label = buildLabel(ele)
  const codeLocation = getElementCodeLocation(ele)

  const chip = {
    id: chipId,
    label,
    type: 'element-text-update',
    data: {
      inlineText: `执行「${chipId}」，`,
      detailText: [
        `<element-text-update id="${chipId}">`,
        '## 操作意图',
        '修改目标元素的 文本 内容',
        '',
        '## 目标元素',
        `- 名称：${ele.tagName.toLowerCase()}`,
        `- 类名：${getElementClassNames(ele) || '无'}`,
        '  注意：若类名包含当前样式文件的前缀，说明它来自该样式文件。当前 CSS Modules 命名规则为 [filepath]--[local]--[hash:base64:8]。',
        '       filepath已将非字母、数字、下划线、短横线的符号转为短横线。',
        `- 代码位置：${codeLocation}`,
        '',
        '## 需要修改的内容',
        nextHTML || '清空内容',
        '</element-text-update>',
      ].join('\n'),
    },
  }

  undoRedoManager.executeBranch({
    aiRequest: {
      message: `[[chip:${chip.id}]]`,
      chips: [chip],
    },
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
