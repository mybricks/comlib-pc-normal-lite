import type { inspectLayoutTarget } from './layoutStyleSources'

export type LayoutElement = HTMLElement | SVGSVGElement

export type LayoutStyleValue = string | number | null
export type LayoutStylePatch = Record<string, LayoutStyleValue>
export type LayoutFileEntry = { fileName: string; source: string }
export type LayoutReplacement = { start: number; end: number; text: string }
export type LayoutFileUpdate = { fileName: string; previous: string; current: string; replacements?: LayoutReplacement[] }

export interface LayoutJsxAnchor {
  fileName: string
  openingStart: number
  openingEnd: number
  tagName: string
  originalOpening: string
}

interface LayoutSourceTarget {
  target: LayoutElement
  sourceLocation: string
}

export interface LayoutTargetInfo extends LayoutSourceTarget {
  /** Less 不可用时由 JSX 承接；仍保留原属性名以复用 Less 写入流程。 */
  fileName?: string
  jsx?: LayoutJsxAnchor
  resolution: ReturnType<typeof inspectLayoutTarget>
  display: string
  position: string
}

export interface LayoutLessWrite extends LayoutSourceTarget {
  kind: 'less'
  fileName: string
  selector: string
  style: LayoutStylePatch
}

export interface LayoutInlineWrite extends LayoutSourceTarget {
  kind: 'jsx-inline'
  fileName: string
  anchor: LayoutJsxAnchor
  role: 'container' | 'item'
  operation: 'enter' | 'exit' | 'edit'
  style: LayoutStylePatch
}

export type LayoutStyleWrite = LayoutLessWrite | LayoutInlineWrite

export interface LayoutWritePlan {
  componentId: string
  container: LayoutElement
  writes: LayoutStyleWrite[]
}
