import context from '../../../../mix/context'
import { undoRedoManager } from '../../../../mix/editors/undoRedo'
import { randomUUID } from '../../../../mix/utils/uuid'
import { getElementCodeLocation } from '../../../../helpers/dom'
import { formatDisplayClassName, getElementClassNames } from '../style'

function buildLabel(ele: HTMLElement) {
  const rawClassNames = Array.from(ele.classList).filter(Boolean)
  const lastClassName = rawClassNames[rawClassNames.length - 1] ?? ''
  const labelTarget = lastClassName ? formatDisplayClassName(lastClassName) : ele.tagName.toLowerCase()
  return `移动 ${labelTarget}`
}

export default function ({ fromEle, toEle, type }) {
  if (!fromEle || !toEle || fromEle === toEle || !fromEle.parentNode || !toEle.parentNode) {
    return {
      type: 'success',
    }
  }

  const parent = fromEle.parentNode
  const nextSibling = fromEle.nextSibling
  const actionId = randomUUID()
  const chipId = randomUUID()
  const label = buildLabel(fromEle)
  const placementText = type === 'before' ? '前面' : '后面'
  const fromCodeLocation = getElementCodeLocation(fromEle)
  const toCodeLocation = getElementCodeLocation(toEle)

  const chip = {
    id: chipId,
    label: `${label} 到目标节点${placementText}`,
    type: 'element-move',
    data: {
      inlineText: `执行「${chipId}」，`,
      detailText: [
        `<element-move id="${chipId}">`,
        '## 操作意图',
        `将操作元素移动到目标元素的${placementText}。`,
        '',
        '## 操作元素',
        `- 名称：${fromEle.tagName.toLowerCase()}`,
        `- 类名：${getElementClassNames(fromEle) || '无'}`,
        `- 代码位置：${fromCodeLocation}`,
        '',
        '## 目标元素',
        `- 名称：${toEle.tagName.toLowerCase()}`,
        `- 类名：${getElementClassNames(toEle) || '无'}`,
        `- 代码位置：${toCodeLocation}`,
        '',
        '## 需要修改的内容',
        `将操作元素移动到目标元素${placementText}。`,
        '</element-move>',
      ].join('\n'),
    },
  }

  undoRedoManager.executeBranch({
    aiRequest: {
      message: `[[chip:${chip.id}]]`,
      chips: [chip],
    },
    execute() {
      if (!toEle.parentNode) return
      toEle.parentNode.insertBefore(fromEle, type === 'before' ? toEle : toEle.nextSibling)
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
