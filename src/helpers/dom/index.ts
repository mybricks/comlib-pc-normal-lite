import { safeParseJson } from '../normal'

export interface DomLoc {
  codeLine: { start: number; end: number }
  files: { jsx: string; less?: string }
  cn?: string[]
}

export type DOMMovePlacement = 'before' | 'after' | 'child'

export function isDOMMoveAllowed(
  fromEle: Element | null | undefined,
  toEle: Element | null | undefined,
  type: string,
): type is DOMMovePlacement {
  if (!fromEle || !toEle) return false
  if (type !== 'before' && type !== 'after' && type !== 'child') return false
  if (fromEle === toEle) return false

  // 祖先节点不能移动到自己的后代内部，否则会形成 DOM 循环。
  if (type === 'child' && fromEle.contains(toEle)) return false

  // 已经处于目标位置时无需再次移动。
  if (type === 'before' && toEle.previousElementSibling === fromEle) return false
  if (type === 'after' && toEle.nextElementSibling === fromEle) return false

  return true
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
