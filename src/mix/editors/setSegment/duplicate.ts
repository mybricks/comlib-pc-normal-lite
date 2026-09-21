import context from '../../context'
import { randomUUID } from '../../utils/uuid'
import { getShadowRoot } from '../../../helpers/designer'
import { undoRedoManager } from '../undoRedo'
import { buildElementInsertChipData, getElementLabel, buildElementInsertAiRequest } from './elementChip'
import {
  createDOMSourceLocationSnapshot,
  restoreDOMSourceLocationSnapshot,
  shiftDOMSourceLocationsAfterReplacement,
  shiftElementSourceLocationByDelta,
  createSourceLineResolver,
  updateElementSourceLocationCodeLine,
} from './sourceLocation'

interface Options {
  fromEle: HTMLElement
}

type SourceRange = {
  start: number
  end: number
}

const countLineBreaks = (value: string) => value.match(/\r\n|\r|\n/g)?.length ?? 0

const getLineIndent = (source: string, position: number) => {
  const lineStart = source.lastIndexOf('\n', Math.max(0, position - 1)) + 1
  const linePrefix = source.slice(lineStart, position)
  return /^[ \t]*$/.test(linePrefix) ? linePrefix : ''
}

const getDuplicateInsertion = (source: string, range: SourceRange, jsx: string) => {
  const indent = getLineIndent(source, range.start)
  const content = `\n${indent}${jsx}`

  return {
    content,
    start: range.end + content.length - jsx.length,
  }
}

const validateSource = (source: string, fileName: string) => {
  if (!window.Babel) return false

  try {
    window.Babel.transform(source, {
      filename: fileName,
      presets: [
        ['env', { modules: 'commonjs' }],
        ['react', { runtime: 'classic' }],
      ],
      plugins: [['transform-typescript', { isTSX: true, allExtensions: true }]],
    })
    return true
  } catch (_) {
    return false
  }
}

const getUniqueLocationElement = (fromEle: HTMLElement, locValue: string) => {
  try {
    const shadowRoot = getShadowRoot()
    const elements = Array.from(shadowRoot.querySelectorAll<HTMLElement>('[data-loc]'))
      .filter((element) => element.dataset.loc === locValue)

    return elements.length === 1 && elements[0] === fromEle
      ? { shadowRoot, element: elements[0] }
      : null
  } catch (_) {
    return null
  }
}

const updateClonedSourceLocations = (
  clone: HTMLElement,
  fileName: string,
  sourceOffsetDelta: number,
  getLineForOffset: ReturnType<typeof createSourceLineResolver>,
) => {
  const update = (element: Element) => {
    try {
      const loc = JSON.parse(element.getAttribute('data-loc') || '')
      if (loc?.files?.jsx === fileName) {
        shiftElementSourceLocationByDelta(element, sourceOffsetDelta)
        updateElementSourceLocationCodeLine(element, getLineForOffset)
      }
    } catch (_) {
      // Runtime metadata is not guaranteed to be valid JSON.
    }
    Array.from(element.children).forEach(update)
  }

  update(clone)
}

const shiftSourceLocationsAtInsertionBoundary = (
  root: ParentNode,
  fileName: string,
  boundary: number,
  delta: number,
  getLineForOffset: ReturnType<typeof createSourceLineResolver>,
) => {
  Array.from(root.querySelectorAll<HTMLElement>('[data-loc]')).forEach((element) => {
    try {
      const loc = JSON.parse(element.dataset.loc || '')
      if (loc?.files?.jsx !== fileName || loc?.jsx?.start !== boundary) return

      shiftElementSourceLocationByDelta(element, delta)
      updateElementSourceLocationCodeLine(element, getLineForOffset)
    } catch (_) {
      // Runtime metadata is not guaranteed to be valid JSON.
    }
  })
}

const insertAfter = (fromEle: HTMLElement, clone: HTMLElement) => {
  const parent = fromEle.parentNode
  if (!parent) return false

  parent.insertBefore(clone, fromEle.nextSibling)
  return true
}

const clearSourceLocationAttributes = (root: Element) => {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  elements.forEach((element) => {
    element.removeAttribute('data-loc')
    element.removeAttribute('data-zone-text-editable')
    element.removeAttribute('data-style-info')
  })
}

const createAIPreviewClone = (fromEle: HTMLElement) => {
  const clone = fromEle.cloneNode(true) as HTMLElement
  clearSourceLocationAttributes(clone)
  return clone
}

const runDuplicateByAI = (fromEle: HTMLElement, jsx: string, title: string) => {
  const clone = createAIPreviewClone(fromEle)
  const actionId = randomUUID()
  // const targetLabel = getElementLabel(fromEle, '节点')
  // const chip = {
  //   id: randomUUID(),
  //   type: 'element-insert',
  //   label: title,
  //   data: buildElementInsertChipData(fromEle, 'after', jsx, '', targetLabel),
  // }

  undoRedoManager.executeBranch({
    aiRequest: buildElementInsertAiRequest({
      ele: fromEle,
      jsx,
      placement: 'after',
    }),
    // aiRequest: {
    //   message: `[[chip:${chip.id}]]`,
    //   chips: [chip],
    // },
    execute() {
      if (!insertAfter(fromEle, clone)) return
      context.component?.actions.addUserAction({
        id: actionId,
        type: 'duplicate',
        title,
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
    actionId,
  }
}

const duplicate = (options: Options) => {
  const fromEle = options?.fromEle
  if (!fromEle?.parentNode) return

  const label = getElementLabel(fromEle, '节点')
  const title = `复制 ${label}`
  const locValue = fromEle.dataset.loc
  const fallbackJsx = createAIPreviewClone(fromEle).outerHTML

  if (!locValue) {
    return runDuplicateByAI(fromEle, fallbackJsx, title)
  }

  const location = getUniqueLocationElement(fromEle, locValue)
  if (!location) {
    return runDuplicateByAI(fromEle, fallbackJsx, title)
  }

  try {
    const loc = JSON.parse(locValue)
    const fileName = loc?.files?.jsx
    const range: SourceRange = {
      start: loc?.jsx?.start,
      end: loc?.jsx?.end,
    }
    const file = context.component?.params?.data?.files?.find((item) => item.fileName === fileName)
    const source = file?.source ? decodeURIComponent(file.source) : ''
    const hasValidRange = (
      Number.isInteger(range.start) &&
      Number.isInteger(range.end) &&
      range.start >= 0 &&
      range.end > range.start &&
      range.end <= source.length
    )

    if (
      !fileName ||
      !file ||
      loc?.swappable !== true ||
      !hasValidRange
    ) {
      return runDuplicateByAI(fromEle, hasValidRange ? source.slice(range.start, range.end) : fallbackJsx, title)
    }

    const jsx = source.slice(range.start, range.end)
    const insertion = getDuplicateInsertion(source, range, jsx)
    const newSource = source.slice(0, range.end) + insertion.content + source.slice(range.end)

    if (!validateSource(newSource, fileName)) {
      return runDuplicateByAI(fromEle, jsx, title)
    }

    const sourceLocationSnapshot = createDOMSourceLocationSnapshot(location.shadowRoot, fileName)
    const clone = fromEle.cloneNode(true) as HTMLElement
    const sourceOffsetDelta = insertion.start - range.start
    const getLineForOffset = createSourceLineResolver(newSource)
    const actionId = randomUUID()
    const replacement = {
      start: range.end,
      end: range.end,
      newLength: insertion.content.length,
      lineDelta: countLineBreaks(insertion.content),
    }

    updateClonedSourceLocations(clone, fileName, sourceOffsetDelta, getLineForOffset)

    undoRedoManager.executeBranch({
      execute() {
        context.updateFile({
          fileName,
          content: newSource,
          type: undefined,
          noUpdateFileSystem: true,
        })
        shiftDOMSourceLocationsAfterReplacement(location.shadowRoot, fileName, replacement)
        shiftSourceLocationsAtInsertionBoundary(
          location.shadowRoot,
          fileName,
          range.end,
          insertion.content.length,
          getLineForOffset,
        )
        insertAfter(fromEle, clone)
        context.component?.actions.addUserAction({
          id: actionId,
          type: 'duplicate',
          title,
          refElement: clone,
        })
      },
      undo() {
        context.updateFile({
          fileName,
          content: source,
          type: undefined,
          noUpdateFileSystem: true,
          updateSource: 'undo',
        })
        clone.remove()
        restoreDOMSourceLocationSnapshot(sourceLocationSnapshot)
        context.component?.actions.removeUserAction(actionId)
      },
    })

    return {
      type: 'success',
      actionId,
    }
  } catch (_) {
    return runDuplicateByAI(fromEle, fallbackJsx, title)
  }
}

export default duplicate
