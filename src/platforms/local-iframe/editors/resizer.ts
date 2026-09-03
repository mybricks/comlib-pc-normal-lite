import { undoRedoManager } from '../../../mix/editors/undoRedo'
import { convertCamelToHyphen } from '../../../utils/string'
import { randomUUID } from '../../../mix/utils/uuid'
import { buildElementStyleUpdateChipData } from '../../../mix/editors/setSegment/elementChip'
import context from '../../../mix/context'

type StyleEntry = [string, any]

function applyStyleEntries(ele: HTMLElement, styleEntries: StyleEntry[]) {
  console.log('applyStyleEntries', { ele, styleEntries })
  styleEntries.forEach(([key, value]) => {
    const property = convertCamelToHyphen(key)
    if (value === null || value === '') {
      ele.style.removeProperty(property)
    } else {
      ele.style.setProperty(property, String(value))
    }
  })
}

function snapshotPreviousStyles(ele: HTMLElement, styleEntries: StyleEntry[]) {
  return styleEntries.map(([key]) => {
    const property = convertCamelToHyphen(key)
    const previousValue = ele.style.getPropertyValue(property)

    return {
      property,
      hadValue: previousValue !== '',
      value: previousValue,
      priority: ele.style.getPropertyPriority(property),
    }
  })
}

function getStyleActionTitle(ele: HTMLElement) {
  return `调整 ${Array.from(ele.classList).slice(-1).join('') || '节点1'} 样式`
}

export default function () {
  let previousStyles: Array<{
    property: string
    hadValue: boolean
    value: string
    priority: string
  }> = []
  let latestStyleEntries: StyleEntry[] = []

  return {
    type: '_resizer',
    value: {
      set({ focusArea }: any, style: any, status: any) {
        const ele = focusArea?.ele as HTMLElement | undefined
        if (!ele) return

        const state = status?.state
        const styleEntries = Object.entries(style ?? {}).filter(([, value]) => value !== undefined) as StyleEntry[]
        if (!styleEntries.length && state !== 'finish') return

        if (state === 'start') {
          previousStyles = snapshotPreviousStyles(ele, styleEntries)
          latestStyleEntries = styleEntries
          return
        }

        if (state === 'ing') {
          if (!previousStyles.length) {
            previousStyles = snapshotPreviousStyles(ele, styleEntries)
          }
          latestStyleEntries = styleEntries
          applyStyleEntries(ele, latestStyleEntries)
          return
        }

        if (state === 'finish') {
          if (!previousStyles.length) {
            previousStyles = snapshotPreviousStyles(ele, styleEntries)
          }
          latestStyleEntries = styleEntries.length ? styleEntries : latestStyleEntries
          if (!latestStyleEntries.length) return

          const undoStyles = previousStyles.map((item) => ({ ...item }))
          const nextStyleEntries = latestStyleEntries.slice()

          const actionId = randomUUID()
          const chip = {
            id: randomUUID(),
            type: 'element-style-update',
            title: getStyleActionTitle(ele),
            data: buildElementStyleUpdateChipData(
              ele,
              nextStyleEntries.map(([key, value]) => ({ key, value })),
              'hello',
            ),
          }
          const addAction = {
            id: actionId,
            type: 'update-style',
            title: getStyleActionTitle(ele),
            refElement: ele,
          }

          try {
            undoRedoManager.executeBranch({
              aiRequest: {
                message: `[[chip:${chip.id}]]`,
                chips: [chip],
              },
              execute() {
                applyStyleEntries(ele, nextStyleEntries)
                context.component!.actions.addUserAction(addAction)
              },
              undo() {
                undoStyles.forEach(({ property, hadValue, value, priority }) => {
                  if (hadValue) {
                    ele.style.setProperty(property, value, priority)
                  } else {
                    ele.style.removeProperty(property)
                  }
                })
                context.component!.actions.removeUserAction(actionId)
              },
            })
          } finally {
            previousStyles = []
            latestStyleEntries = []
          }
        }
      },
    },
  }
}
