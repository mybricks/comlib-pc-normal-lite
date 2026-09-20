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

  // 祖先节点不能移动到自己的后代内部，否则 appendChild 会抛出异常。
  if (type === 'child' && fromEle.contains(toEle)) {
    return
  }

  const parent = fromEle.parentNode
  const nextSibling = fromEle.nextSibling
  const actionId = randomUUID()
  const chipId = randomUUID(8)
  const label = buildLabel(fromEle)
  const placementText = type === 'before' ? '前面' : type === 'after' ? '后面' : '内部'
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
