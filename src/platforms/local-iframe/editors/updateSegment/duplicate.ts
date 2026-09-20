import context from '../../../../mix/context'
import { undoRedoManager } from '../../../../mix/editors/undoRedo'
import { randomUUID } from '../../../../mix/utils/uuid'
import { getElementCodeLocation } from '../../../../helpers/dom'
import { formatDisplayClassName, getElementClassNames } from '../style'

interface Props {
  fromEle: HTMLElement
}

function buildLabel(ele: HTMLElement) {
  const rawClassNames = Array.from(ele.classList).filter(Boolean)
  const lastClassName = rawClassNames[rawClassNames.length - 1] ?? ''
  const labelTarget = lastClassName ? formatDisplayClassName(lastClassName) : ele.tagName.toLowerCase()
  return `复制 ${labelTarget}`
}

export default function ({ fromEle }: Props) {
  if (!fromEle?.parentNode) {
    return {
      type: 'success',
    }
  }

  const clone = fromEle.cloneNode(true) as HTMLElement
  const actionId = randomUUID()
  const chipId = randomUUID(8)
  const label = buildLabel(fromEle)
  const codeLocation = getElementCodeLocation(fromEle)

  const chip = {
    id: chipId,
    label,
    type: 'element-insert',
    data: {
      inlineText: `执行「${chipId}」，`,
      detailText: [
        `<element-insert id="${chipId}">`,
        '## 操作意图',
        '复制目标 DOM 元素及其完整子树，并插入到目标元素后面。',
        '',
        '## 目标元素',
        `- 名称：${fromEle.tagName.toLowerCase()}`,
        `- 类名：${getElementClassNames(fromEle) || '无'}`,
        '  注意：若类名包含当前样式文件的前缀，说明它来自该样式文件。当前 CSS Modules 命名规则为 [filepath]--[local]--[hash:base64:8]。',
        '       filepath已将非字母、数字、下划线、短横线的符号转为短横线。',
        `- 代码位置：${codeLocation}`,
        '',
        '## 需要修改的内容',
        '在目标元素后面插入一个内容完全相同的兄弟节点。',
        '</element-insert>',
      ].join('\n'),
    },
  }

  undoRedoManager.executeBranch({
    aiRequest: {
      message: `[[chip:${chip.id}]]`,
      chips: [chip],
    },
    execute() {
      if (!fromEle.parentNode) return
      fromEle.parentNode.insertBefore(clone, fromEle.nextSibling)
      context.component?.actions.addUserAction({
        id: actionId,
        type: 'duplicate',
        title: label,
        refElement: clone,
      })
    },
    undo() {
      clone.remove()
      context.component?.actions.removeUserAction(actionId)
    },
  })

  return {
    type: 'success',
  }
}
