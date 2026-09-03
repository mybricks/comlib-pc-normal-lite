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
  targetEle: HTMLElement
}

type PendingStyleBranch = {
  ele: HTMLElement
  targetEle: HTMLElement
  actionId: string
  chipId: string
  classNames: string
  codeLocation: string
  label: string
  entries: Map<string, PendingStyleEntry>
}

// gap 在不支持 flex gap 时，退化成的 margin 组合。
const GAP_MARGIN_MAP: Record<string, string[]> = {
  gap: ['marginRight', 'marginBottom'],
  'row-gap': ['marginBottom'],
  'column-gap': ['marginRight'],
}

// 判断当前属性是不是 gap 系列。
function isGapProperty(property: string) {
  return property === 'gap' || property === 'row-gap' || property === 'column-gap'
}

// 判断某个元素是不是 flex 容器。
function isFlexContainer(ele: HTMLElement) {
  const view = ele.ownerDocument?.defaultView
  if (!view) return false

  const display = view.getComputedStyle(ele).display
  return display === 'flex' || display === 'inline-flex'
}

// gap 先尝试写到父级 flex 容器；不支持时，落到当前元素的 margin 兜底。
function resolvePendingStyleEntries(ele: HTMLElement, key: string, value: any): PendingStyleEntry[] {
  const property = convertCamelToHyphen(key)
  if (!property) return []

  if (!isGapProperty(property)) {
    return [{
      key,
      value,
      target: resolveStyleTarget(ele, property),
      targetEle: ele,
    }]
  }

  const parentEle = ele.parentElement
  if (parentEle && isFlexContainer(parentEle)) {
    return [{
      key,
      value,
      target: resolveStyleTarget(parentEle, property),
      targetEle: parentEle,
    }]
  }

  return (GAP_MARGIN_MAP[property] ?? []).map((marginKey) => ({
    key: marginKey,
    value,
    target: resolveStyleTarget(ele, convertCamelToHyphen(marginKey)),
    targetEle: ele,
  }))
}

export default function () {
  let pendingStyleBranch: PendingStyleBranch | null = null

  // 把暂存的样式修改提交成一次 undo/redo 分支。
  const commitPendingStyleBranch = () => {
    const branch = pendingStyleBranch
    if (!branch || !branch.entries.size) return

    pendingStyleBranch = null

    const displayEle = branch.targetEle
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
      label: `调整 ${formatDisplayClassName(
        Array.from(displayEle.classList).filter(Boolean).slice(-1)[0] ?? displayEle.tagName.toLowerCase(),
      )} 样式`,
      type: 'element-style-update',
      data: {
        inlineText: `执行「${branch.chipId}」，`,
        detailText: [
          `<element-style-update-operation id="${branch.chipId}">`,
          '## 操作意图',
          'dom 样式修改。请优先修改样式文件（Less/CSS）中的对应规则；只有在样式文件不存在、无法可靠定位，或该样式确实只能由运行时 prop 生效时，才修改 JSX 源码中对应的 prop。',
          '',
          '## 目标元素',
          `- 名称：${displayEle.tagName.toLowerCase()}`,
          `- 类名：${getElementClassNames(displayEle) || '无'}`,
          `- 代码位置：${getElementCodeLocation(displayEle)}`,
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
      // 真正执行时，把缓存的样式写回对应目标。
      execute() {
        resolvedEntries.forEach(({ value, target }) => {
          applyStyleTarget(target, value)
        })
        context.component?.actions.addUserAction({
          id: branch.actionId,
          type: 'update-style',
          title: `调整 ${formatDisplayClassName(
            Array.from(displayEle.classList).filter(Boolean).slice(-1)[0] ?? displayEle.tagName.toLowerCase(),
          )} 样式`,
          refElement: displayEle,
        })
      },
      // 撤销时，把每个目标恢复到修改前的样子。
      undo() {
        previousTargets.forEach((target) => {
          restoreStyleTarget(target)
        })
        context.component?.actions.removeUserAction(branch.actionId)
      },
    })
  }

  // 处理一次样式输入，把它们合并进当前暂存分支并立即反映到 DOM。
  const applyPendingStyleEntries = (ele: HTMLElement, styleEntries: StyleEntry[]) => {
    if (pendingStyleBranch && pendingStyleBranch.ele !== ele) {
      commitPendingStyleBranch()
    }

    if (!pendingStyleBranch) {
      const classNames = getElementClassNames(ele)
      const rawClassNames = Array.from(ele.classList).filter(Boolean)
      const lastClassName = rawClassNames[rawClassNames.length - 1] ?? ''
      const labelTarget = lastClassName ? formatDisplayClassName(lastClassName) : ele.tagName.toLowerCase()

      pendingStyleBranch = {
        ele,
        targetEle: ele,
        actionId: randomUUID(),
        chipId: randomUUID(),
        classNames,
        codeLocation: getElementCodeLocation(ele),
        label: `调整 ${labelTarget} 样式`,
        entries: new Map(),
      }
    }

    styleEntries.forEach(([key, value]) => {
      const resolvedEntries = resolvePendingStyleEntries(ele, key, value)
      // 同一个属性可能展开成多个落点，逐个写入并按属性名去重。
      resolvedEntries.forEach((entry) => {
        const pendingEntry = pendingStyleBranch!.entries.get(entry.target.property)
        if (!pendingEntry) {
          pendingStyleBranch!.entries.set(entry.target.property, entry)
          if (pendingStyleBranch!.targetEle === pendingStyleBranch!.ele && entry.targetEle !== pendingStyleBranch!.ele) {
            pendingStyleBranch!.targetEle = entry.targetEle
          }
          applyStyleTarget(entry.target, value)
          return
        }

        pendingEntry.key = entry.key
        pendingEntry.value = value
        pendingEntry.targetEle = entry.targetEle
        if (pendingStyleBranch!.targetEle === pendingStyleBranch!.ele && entry.targetEle !== pendingStyleBranch!.ele) {
          pendingStyleBranch!.targetEle = entry.targetEle
        }
        applyStyleTarget(pendingEntry.target, value)
      })
    })
  }

  // 入口函数，按状态处理一次 setStyle 调用。
  return (params, { ele, state, style }: { ele?: HTMLElement; state?: string; style?: Record<string, any> }) => {
    /**
     * state: start, ing, finish
     */
    const targetEle = ele ?? params?.focusArea?.ele
    if (!targetEle) return

    const styleEntries = Object.entries(style ?? {}).filter(([, value]) => value !== undefined) as StyleEntry[]
    if (!styleEntries.length && state !== 'finish') return

    console.log('setstyle', style)

    if (state === 'start') {
      applyPendingStyleEntries(targetEle, styleEntries)
      return
    }

    if (state === 'ing' || state === 'moving') {
      applyPendingStyleEntries(targetEle, styleEntries)
      return
    }

    if (state === 'finish') {
      if (styleEntries.length) {
        applyPendingStyleEntries(targetEle, styleEntries)
      } else if (pendingStyleBranch && pendingStyleBranch.ele !== targetEle) {
        commitPendingStyleBranch()
      }

      try {
        commitPendingStyleBranch()
      } finally {
        pendingStyleBranch = null
      }
    }
  }
}
