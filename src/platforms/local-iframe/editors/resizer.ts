import context from '../../../mix/context'
import { undoRedoManager } from '../../../mix/editors/undoRedo'
import { randomUUID } from '../../../mix/utils/uuid'
import { getElementCodeLocation } from '../../../helpers/dom'
import { convertCamelToHyphen } from '../../../utils/string'
import {
  applyStyleTarget,
  formatDisplayClassName,
  formatStyleValue,
  getElementClassNames,
  restoreStyleTarget,
  resolveStyleTarget,
} from './style'
import type { StyleEntry, StyleTarget } from './style'

type PendingStyleEntry = {
  key: string
  value: any
  target: StyleTarget
}

type PendingStyleBranch = {
  ele: HTMLElement
  actionId: string
  chipId: string
  classNames: string
  codeLocation: string
  label: string
  entries: Map<string, PendingStyleEntry>
}

function buildLabel(ele: HTMLElement) {
  const rawClassNames = Array.from(ele.classList).filter(Boolean)
  const lastClassName = rawClassNames[rawClassNames.length - 1] ?? ''
  const labelTarget = lastClassName ? formatDisplayClassName(lastClassName) : ele.tagName.toLowerCase()
  return `调整 ${labelTarget} 样式`
}

export default function () {
  let pendingStyleBranch: PendingStyleBranch | null = null

  const commitPendingStyleBranch = () => {
    const branch = pendingStyleBranch
    if (!branch || !branch.entries.size) return

    pendingStyleBranch = null

    const resolvedEntries = Array.from(branch.entries.values())
    const styleChangeLines = resolvedEntries.map(({ key, value }) => {
      const property = convertCamelToHyphen(key)
      const nextValue =
        value === null || value === undefined || value === ''
          ? '删除'
          : formatStyleValue(value)
      return `- ${property}：${nextValue}`
    })
    const previousTargets = resolvedEntries.map(({ target }) => target)
    const chip = {
      id: branch.chipId,
      label: branch.label,
      type: 'element-style-update',
      data: {
        inlineText: `执行「${branch.chipId}」，`,
        detailText: [
          `<element-style-update-operation id="${branch.chipId}">`,
          '## 操作意图',
          'dom 样式修改。请优先修改样式文件（Less/CSS）中的对应规则；只有在样式文件不存在、无法可靠定位，或该样式确实只能由运行时 prop 生效时，才修改 JSX 源码中对应的 prop。',
          '',
          '## 目标元素',
          `- 名称：${branch.ele.tagName.toLowerCase()}`,
          `- 类名：${branch.classNames || '无'}`,
          `- 代码位置：${branch.codeLocation}`,
          '',
          '## 需要修改的内容',
          ...styleChangeLines,
          '</element-style-update-operation>',
        ].join('\n'),
      },
    }

    undoRedoManager.executeBranch({
      aiRequest: {
        message: `[[chip:${chip.id}]]`,
        chips: [chip],
      },
      execute() {
        resolvedEntries.forEach(({ value, target }) => {
          applyStyleTarget(target, value)
        })
        context.component?.actions.addUserAction({
          id: branch.actionId,
          type: 'update-style',
          title: branch.label,
          refElement: branch.ele,
        })
      },
      undo() {
        previousTargets.forEach((target) => {
          restoreStyleTarget(target)
        })
        context.component?.actions.removeUserAction(branch.actionId)
      },
    })
  }

  const applyPendingStyleEntries = (ele: HTMLElement, styleEntries: StyleEntry[]) => {
    if (!pendingStyleBranch) {
      pendingStyleBranch = {
        ele,
        actionId: randomUUID(),
        chipId: randomUUID(),
        classNames: getElementClassNames(ele),
        codeLocation: getElementCodeLocation(ele),
        label: buildLabel(ele),
        entries: new Map(),
      }
    }

    styleEntries.forEach(([key, value]) => {
      const property = convertCamelToHyphen(key)
      const target = resolveStyleTarget(ele, property)
      const pendingEntry = pendingStyleBranch!.entries.get(target.property)

      if (!pendingEntry) {
        pendingStyleBranch!.entries.set(target.property, {
          key,
          value,
          target,
        })
      } else {
        pendingEntry.key = key
        pendingEntry.value = value
      }

      applyStyleTarget(target, value)
    })
  }

  return {
    type: '_resizer',
    value: {
      set(params: any, style: Record<string, any>, { state }: { state?: string }) {
        const ele = params?.focusArea?.ele as HTMLElement | undefined
        if (!ele) return

        if (state === 'ing') {
          const styleEntries = Object.entries(style ?? {}).filter(([, value]) => value !== undefined) as StyleEntry[]
          if (!styleEntries.length) return
          applyPendingStyleEntries(ele, styleEntries)
          return
        }

        if (state === 'finish') {
          try {
            commitPendingStyleBranch()
          } finally {
            pendingStyleBranch = null
          }
        }
      },
    },
  }
}
