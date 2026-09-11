interface DomLoc {
  codeLine: { start: number; end: number }
  files: { jsx: string; less?: string }
  cn?: string[]
}

function safeParseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch (_) {
    return undefined
  }
}

export function getClosestDomLoc<T extends DomLoc>(el: Element): T | undefined {
  let current: Element | null = el
  while (current) {
    const loc = safeParseJson<T>(current.getAttribute('data-loc'))
    if (loc) return loc
    current = current.parentElement
  }
  return undefined
}

export function getElementCodeLocation(el?: Element): string {
  if (!el) return '未知'

  const loc = getClosestDomLoc<DomLoc>(el)
  if (!loc) return '未知'

  const jsxFile = loc.files?.jsx
  const startLine = loc.codeLine?.start
  const endLine = loc.codeLine?.end

  if (!jsxFile && !startLine) return '未知'

  const lineDesc =
    startLine && endLine && endLine !== startLine
      ? `L${startLine}-L${endLine}`
      : startLine
        ? `L${startLine}`
        : '未知行'

  return jsxFile ? `${jsxFile}#${lineDesc}` : lineDesc
}

export function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function getElementClassNames(ele) {
  const classNames: string[] = Array.from(ele.classList)
  return classNames.map((className) => {
    if (className.match('%2F')) {
      return decodeURIComponent(className)
    }

    return className
  }).join(' ')
}