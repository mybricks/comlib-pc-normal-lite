import { parse } from '@babel/parser'
import type { LayoutElement, LayoutFileEntry, LayoutJsxAnchor } from './layoutTypes'

/** 每次规划/准备各持有一个解析缓存，不跨版本保留 AST。 */
export function createLayoutJsxReader(files: LayoutFileEntry[]) {
  const cache = new Map<string, { source: string; openings: any[]; elements: any[] }>()
  const read = (fileName: string) => {
    const cached = cache.get(fileName)
    if (cached) return cached
    const file = files.find(file => file.fileName === fileName)
    if (!file) throw new Error(`找不到 JSX 文件：${fileName}`)
    const source = decodeURIComponent(file.source)
    const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] })
    const openings: any[] = [], elements: any[] = []
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'JSXElement') { elements.push(node); openings.push(node.openingElement) }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'comments' || key === 'tokens') continue
        if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object') visit(value)
      }
    }
    visit(ast)
    const result = { source, openings, elements }
    cache.set(fileName, result)
    return result
  }
  return {
    read,
    resolve(target: LayoutElement): LayoutJsxAnchor | undefined {
      let loc: any
      try { loc = JSON.parse(target.dataset.loc || '') } catch { return undefined }
      if (!loc?.files?.jsx || !Number.isInteger(loc.jsx?.start) || !Number.isInteger(loc.jsx?.end)) return undefined
      const { source, elements } = read(loc.files.jsx)
      const element = elements.find(node => node.start === loc.jsx.start && node.end === loc.jsx.end)
      const opening = element?.openingElement
      if (!opening || opening.end !== loc.tag?.end) throw new Error('JSX 源码位置已变化，请重新选择元素')
      const tagName = opening.name.type === 'JSXIdentifier' ? opening.name.name : ''
      // <Card style> 是否转发到 DOM 不可推断。只写原生 HTML / SVG 的开标签。
      if (!/^[a-z][a-z0-9]*$/.test(tagName) || tagName !== target.tagName.toLowerCase()) return undefined
      return { fileName: loc.files.jsx, openingStart: opening.start, openingEnd: opening.end,
        tagName, originalOpening: source.slice(opening.start, opening.end) }
    },
    opening(anchor: LayoutJsxAnchor) {
      const { source, openings } = read(anchor.fileName)
      const opening = openings.find(node => node.start === anchor.openingStart && node.end === anchor.openingEnd)
      if (!opening || source.slice(opening.start, opening.end) !== anchor.originalOpening) {
        throw new Error('JSX 源码已变化，请重新选择元素')
      }
      return { source, opening }
    },
  }
}

export type LayoutJsxReader = ReturnType<typeof createLayoutJsxReader>
