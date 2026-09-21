import context from '../../../mix/context'
import { undoRedoManager } from '../../../mix/editors/undoRedo'
import { randomUUID } from '../../../mix/utils/uuid'
import { buildElementStyleUpdateAiRequest } from '../../../mix/editors/setSegment/elementChip'
import { convertCamelToHyphen } from '../../../utils/string'
import {
  applyStyleTarget,
  formatDisplayClassName,
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
    const previousTargets = resolvedEntries.map(({ target }) => target)

    undoRedoManager.executeBranch({
      aiRequest: buildElementStyleUpdateAiRequest({
        ele: branch.ele,
        styles: resolvedEntries.map(({ key, value }) => ({ key, value })),
      }),
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
          const styleEntries = (Object.entries(style ?? {}) as StyleEntry[])
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => ([key, Math.max(value, 0)] as StyleEntry))
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
