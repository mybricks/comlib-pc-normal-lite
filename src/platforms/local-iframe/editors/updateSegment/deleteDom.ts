import context from '../../../../mix/context'
import { undoRedoManager } from '../../../../mix/editors/undoRedo'
import { randomUUID } from '../../../../mix/utils/uuid'
import { getElementCodeLocation } from '../../../../helpers/dom'
import { formatDisplayClassName, getElementClassNames } from '../style'

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
  const chipId = randomUUID()
  const label = buildLabel(ele)
  const codeLocation = getElementCodeLocation(ele)

  const chip = {
    id: chipId,
    label,
    type: 'element-delete',
    data: {
      inlineText: `执行「${chipId}」，`,
      detailText: [
        `<element-delete id="${chipId}">`,
        '## 操作意图',
        '删除目标 DOM 元素及其完整子树。',
        '',
        '## 目标元素',
        `- 名称：${ele.tagName.toLowerCase()}`,
        `- 类名：${getElementClassNames(ele) || '无'}`,
        '  注意：若类名包含当前样式文件的前缀，说明它来自该样式文件。当前 CSS Modules 命名规则为 [filepath]--[local]--[hash:base64:8]。',
        `- 代码位置：${codeLocation}`,
        '',
        '## 需要修改的内容',
        '从页面结构中移除该元素。',
        '</element-delete>',
      ].join('\n'),
    },
  }

  undoRedoManager.executeBranch({
    aiRequest: {
      message: `[[chip:${chip.id}]]`,
      chips: [chip],
    },
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
