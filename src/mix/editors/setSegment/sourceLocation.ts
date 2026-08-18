export type SourceRange = {
  start: number
  end: number
}

export type SourceReplacement = SourceRange & {
  newLength: number
  /** Optional line count delta, used when the caller knows the replacement text. */
  lineDelta?: number
}

type SourceLocationSnapshot = Map<Element, {
  loc: string | null
  textEditable: string | null
  styleInfo: string | null
}>

const escapeDataLocFilenameForSelector = (fileName: string) => {
  // data-loc 是 JSON 字符串，先使用 JSON 中实际保存的文件名，再转义 CSS 字符串。
  const jsonValue = JSON.stringify(fileName).slice(1, -1)
  return jsonValue.replace(/[\\"]/g, '\\$&')
}

const getLocationElements = (root: ParentNode | null, fileName?: string) => {
  if (!root) return []
  const selector = fileName
    ? `[data-loc*="${escapeDataLocFilenameForSelector(fileName)}"]`
    : '[data-loc]'
  const elements = Array.from(root.querySelectorAll(selector))
  if (root instanceof Element && root.matches(selector)) {
    elements.unshift(root)
  }
  return elements
}

const getElementJsxFileName = (ele: Element) => {
  try {
    return JSON.parse(ele.getAttribute('data-loc') || '')?.files?.jsx
  } catch {
    return undefined
  }
}

/**
 * Return the 1-based source line for an absolute character offset. Both CRLF
 * and standalone CR line endings are treated as a single line break.
 */
export const createSourceLineResolver = (source: string) => {
  const lineStarts = [0]
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\n' || (char === '\r' && source[index + 1] !== '\n')) {
      lineStarts.push(index + 1)
    }
  }

  return (offset: number): number | undefined => {
    if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return undefined

    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (lineStarts[middle] <= offset) {
        low = middle
      } else {
        high = middle - 1
      }
    }
    return low + 1
  }
}

/** Recalculate codeLine from the current JSX offsets after source reordering. */
export const updateElementSourceLocationCodeLine = (
  ele: Element,
  getLineForOffset: (offset: number) => number | undefined,
) => {
  const locValue = ele.getAttribute('data-loc')
  if (!locValue) return

  try {
    const loc = JSON.parse(locValue)
    const start = loc?.jsx?.start
    const end = loc?.jsx?.end
    if (typeof start !== 'number' || typeof end !== 'number') return

    const startLine = getLineForOffset(start)
    const endLine = getLineForOffset(end)
    if (startLine == null || endLine == null) return

    loc.codeLine = {
      ...loc.codeLine,
      start: startLine,
      end: endLine,
    }
    ele.setAttribute('data-loc', JSON.stringify(loc))
  } catch {
    // Runtime metadata can be malformed; keep it unchanged when it cannot be parsed.
  }
}

const shiftLocByDelta = (loc: any, delta: number) => {
  if (!loc || typeof delta !== 'number' || delta === 0) return loc

  const nextLoc = { ...loc }

  if (nextLoc.jsx && typeof nextLoc.jsx.start === 'number' && typeof nextLoc.jsx.end === 'number') {
    nextLoc.jsx = {
      ...nextLoc.jsx,
      start: nextLoc.jsx.start + delta,
      end: nextLoc.jsx.end + delta,
    }
  }

  if (nextLoc.tag && typeof nextLoc.tag.end === 'number') {
    nextLoc.tag = {
      ...nextLoc.tag,
      end: nextLoc.tag.end + delta,
    }
  }

  return nextLoc
}

const shiftRangeAfterReplacement = (range: SourceRange, replacement: SourceReplacement): SourceRange => {
  const delta = replacement.newLength - (replacement.end - replacement.start)
  if (delta === 0) return range

  const shiftStart = (position: number) => {
    if (position <= replacement.start) return position
    if (position >= replacement.end) return position + delta
    return replacement.start
  }
  const shiftEnd = (position: number) => {
    if (position <= replacement.start) return position
    if (position >= replacement.end) return position + delta
    return replacement.start + replacement.newLength
  }

  return {
    start: shiftStart(range.start),
    end: shiftEnd(range.end),
  }
}

const shiftLocAfterReplacement = (loc: any, replacement: SourceReplacement) => {
  if (!loc) return loc

  const nextLoc = { ...loc }
  if (nextLoc.jsx && typeof nextLoc.jsx.start === 'number' && typeof nextLoc.jsx.end === 'number') {
    nextLoc.jsx = shiftRangeAfterReplacement(nextLoc.jsx, replacement)
  }
  if (nextLoc.tag && typeof nextLoc.tag.end === 'number') {
    nextLoc.tag = {
      ...nextLoc.tag,
      end: shiftRangeAfterReplacement({ start: nextLoc.tag.end, end: nextLoc.tag.end }, replacement).end,
    }
  }

  const lineDelta = replacement.lineDelta
  if (
    lineDelta &&
    nextLoc.codeLine &&
    typeof nextLoc.codeLine.start === 'number' &&
    typeof nextLoc.codeLine.end === 'number' &&
    loc.jsx &&
    typeof loc.jsx.start === 'number' &&
    typeof loc.jsx.end === 'number'
  ) {
    // For an insertion, the boundary belongs to the preceding node. A target
    // that starts exactly at the boundary is handled by its insert caller.
    const isAfterReplacement = (position: number) => (
      replacement.start === replacement.end
        ? position > replacement.start
        : position >= replacement.end
    )
    nextLoc.codeLine = { ...nextLoc.codeLine }
    if (isAfterReplacement(loc.jsx.start)) nextLoc.codeLine.start += lineDelta
    if (isAfterReplacement(loc.jsx.end)) nextLoc.codeLine.end += lineDelta
  }

  return nextLoc
}

const shiftStyleInfoAfterReplacement = (value: string, replacement: SourceReplacement) => {
  try {
    const styleInfo = JSON.parse(value)
    let changed = false
    Object.values(styleInfo).forEach((entry: any) => {
      if (typeof entry?.valueStart !== 'number' || typeof entry?.valueEnd !== 'number') return
      const shifted = shiftRangeAfterReplacement({ start: entry.valueStart, end: entry.valueEnd }, replacement)
      if (shifted.start === entry.valueStart && shifted.end === entry.valueEnd) return
      entry.valueStart = shifted.start
      entry.valueEnd = shifted.end
      changed = true
    })
    return changed ? JSON.stringify(styleInfo) : value
  } catch {
    return value
  }
}

const restoreAttribute = (ele: Element, attrName: string, value: string | null) => {
  if (value == null) {
    ele.removeAttribute(attrName)
  } else {
    ele.setAttribute(attrName, value)
  }
}

export const createDOMSourceLocationSnapshot = (root: ParentNode | null, fileName?: string): SourceLocationSnapshot => {
  const snapshot: SourceLocationSnapshot = new Map()
  getLocationElements(root, fileName).forEach((ele) => {
    if (fileName && getElementJsxFileName(ele) !== fileName) return
    snapshot.set(ele, {
      loc: ele.getAttribute('data-loc'),
      textEditable: ele.getAttribute('data-zone-text-editable'),
      styleInfo: ele.getAttribute('data-style-info'),
    })
  })
  return snapshot
}

export const restoreDOMSourceLocationSnapshot = (snapshot: SourceLocationSnapshot) => {
  snapshot.forEach((item, ele) => {
    restoreAttribute(ele, 'data-loc', item.loc)
    restoreAttribute(ele, 'data-zone-text-editable', item.textEditable)
    restoreAttribute(ele, 'data-style-info', item.styleInfo)
  })
}

/**
 * noUpdateFileSystem 会保留当前 DOM，因此源码变长/变短后需要同步其绝对偏移。
 * 只处理同一 JSX 文件，避免影响其它页面或组件实例的定位数据。
 */
export const shiftDOMSourceLocationsAfterReplacement = (
  root: ParentNode | null,
  fileName: string,
  replacement: SourceReplacement,
) => {
  if (replacement.newLength === replacement.end - replacement.start) return

  getLocationElements(root, fileName).forEach((ele) => {
    const locValue = ele.getAttribute('data-loc')
    if (!locValue) return

    try {
      const loc = JSON.parse(locValue)
      if (loc?.files?.jsx !== fileName) return

      ele.setAttribute('data-loc', JSON.stringify(shiftLocAfterReplacement(loc, replacement)))

      const textEditable = ele.getAttribute('data-zone-text-editable')
      if (textEditable) {
        ele.setAttribute('data-zone-text-editable', JSON.stringify(shiftLocAfterReplacement(JSON.parse(textEditable), replacement)))
      }

      const styleInfo = ele.getAttribute('data-style-info')
      if (styleInfo) {
        ele.setAttribute('data-style-info', shiftStyleInfoAfterReplacement(styleInfo, replacement))
      }
    } catch {
      // 属性来自运行时注入；格式不可信时保留原值并让调用方按原有降级路径处理。
    }
  })
}

export const shiftElementSourceLocationByDelta = (ele: Element, delta: number) => {
  const locValue = ele.getAttribute('data-loc')
  if (!locValue || delta === 0) return

  try {
    ele.setAttribute('data-loc', JSON.stringify(shiftLocByDelta(JSON.parse(locValue), delta)))

    const textEditable = ele.getAttribute('data-zone-text-editable')
    if (textEditable) {
      ele.setAttribute('data-zone-text-editable', JSON.stringify(shiftLocByDelta(JSON.parse(textEditable), delta)))
    }

    const styleInfo = ele.getAttribute('data-style-info')
    if (styleInfo) {
      const shifted = JSON.parse(styleInfo)
      Object.values(shifted).forEach((entry: any) => {
        if (typeof entry?.valueStart === 'number') entry.valueStart += delta
        if (typeof entry?.valueEnd === 'number') entry.valueEnd += delta
      })
      ele.setAttribute('data-style-info', JSON.stringify(shifted))
    }
  } catch {
    // 保留无法解析的运行时属性，避免一次定位同步破坏画布操作。
  }
}
