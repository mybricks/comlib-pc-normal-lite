import { tryParseLess, stringifyLess } from '../../../utils/transform/less'
import { convertHyphenToCamel } from '../../../../utils/string'
import { extractLessImportsFromSource, resolveLessFilePath } from './resolveLessFilePath'
import { prepareLayoutTarget } from './layoutWriteTargets'
import { createLayoutJsxReader } from './layoutJsxSource'
import { applyLayoutReplacements, prepareLayoutInlineWrite } from './layoutInlineStyle'
import type { LayoutElement, LayoutStyleWrite, LayoutWritePlan, LayoutFileUpdate, LayoutReplacement } from './layoutTypes'

class LayoutStyleFileUnavailable extends Error {}

type FileEntry = { fileName: string; source: string }
type ResolveRule = (css: Record<string, any>, selector: string, target: LayoutElement) => Record<string, any>

/**
 * 找出一个 DOM 元素应该写入的 Less 文件，返回组件 files 列表中的文件名。
 * 优先使用编译时 data-loc.files.less 记录的路径；没有时，先找到 files.jsx 对应的源码，
 * 再依次检查：该 JSX 导入的 Less → 入口 JSX 导入的 Less → 文件列表中的所有 Less。
 *
 * 例如 components/Card/index.tsx 导入 ./index.less，就写 components/Card/index.less；
 * Card 没有自己的 Less import 时，可以使用入口文件导入的共享 Less。
 * 选定一层后必须只有一个候选；有两个 Less 时直接报错，不随意挑一个，也不继续往下一层猜。
 */
export function resolveLayoutStyleFile(target: LayoutElement, files: FileEntry[], entryFileName?: string): string {
  let loc: any
  try { loc = JSON.parse(target.dataset.loc || '') } catch {
    throw new Error('布局元素缺少有效的源码定位信息')
  }
  let fileName = loc?.files?.less
  if (!fileName) {
    const source = files.find(file => file.fileName === loc?.files?.jsx)
    if (!source) throw new Error('找不到布局元素对应的 TSX 文件')
    const entry = files.find(file => file.fileName === (entryFileName || 'index.tsx'))
      || files.find(file => file.fileName === 'index.tsx')
    const ownImports = Array.from(new Set(extractLessImportsFromSource(source.fileName, source.source)))
    const entryImports = entry ? Array.from(new Set(extractLessImportsFromSource(entry.fileName, entry.source))) : []
    const candidates = ownImports.length ? ownImports : entryImports.length ? entryImports
      : files.filter(file => /\.less$/i.test(file.fileName)).map(file => file.fileName)
    if (candidates.length !== 1) throw new LayoutStyleFileUnavailable('无法唯一确定布局元素的 Less 文件')
    fileName = resolveLessFilePath(candidates[0], files, entryFileName)
  }
  if (!files.some(file => file.fileName === fileName)) throw new LayoutStyleFileUnavailable('找不到布局对应的 Less 文件')
  return fileName
}

/** 只有已知的 Less 归属缺失/歧义允许转 JSX；解析异常仍向上传递。 */
export function tryResolveLayoutStyleFile(target: LayoutElement, files: FileEntry[], entryFileName?: string): string | undefined {
  try { return resolveLayoutStyleFile(target, files, entryFileName) } catch (error) {
    if (error instanceof LayoutStyleFileUnavailable) return undefined
    throw error
  }
}

/** 全部准备完成再写文件；每个子元素的多条修改一起接受或一起跳过。 */
export function prepareLayoutStyleChange(plan: LayoutWritePlan, files: FileEntry[], componentId: string, resolveRule: ResolveRule, entryFileName?: string): LayoutFileUpdate[] {
  if (!plan || plan.componentId !== componentId || !plan.container?.isConnected || !plan.writes?.length) {
    throw new Error('布局目标已变化，请重新选择容器')
  }
  type FileDraft = { fileName: string; previous: string } & (
    { kind: 'less'; css: Record<string, any> } |
    { kind: 'jsx-inline'; replacements: LayoutReplacement[] }
  )
  const reader = createLayoutJsxReader(files)
  const initialFiles = new Map<string, FileDraft>()
  const drafts = new Map<string, FileDraft>()
  const writesByTarget = new Map<LayoutElement, LayoutStyleWrite[]>()
  const anchorTargets = new Map<string, Set<LayoutElement>>()
  const anchorKey = (write: LayoutStyleWrite) => write.kind === 'jsx-inline'
    ? `${write.fileName}:${write.anchor.openingStart}:${write.anchor.openingEnd}` : ''
  for (const write of plan.writes) {
    const writes = writesByTarget.get(write.target) || []
    writes.push(write)
    writesByTarget.set(write.target, writes)
    if (write.kind === 'jsx-inline') {
      const key = anchorKey(write)
      const targets = anchorTargets.get(key) || new Set<LayoutElement>()
      targets.add(write.target)
      anchorTargets.set(key, targets)
    }
  }
  const readFile = (write: LayoutStyleWrite): FileDraft => {
    const cached = drafts.get(write.fileName) || initialFiles.get(write.fileName)
    if (cached) return cached
    const file = files.find(file => file.fileName === write.fileName)
    if (!file) throw new Error(`找不到布局源码：${write.fileName}`)
    const previous = decodeURIComponent(file.source)
    let draft: FileDraft
    if (write.kind === 'jsx-inline') {
      draft = { kind: 'jsx-inline', fileName: write.fileName, previous, replacements: [] }
    } else {
      const css = tryParseLess(previous)
      if (!css) throw new Error(`Less 解析失败，未修改布局：${write.fileName}`)
      draft = { kind: 'less', fileName: write.fileName, previous, css }
    }
    initialFiles.set(write.fileName, draft)
    return draft
  }
  for (const [target, writes] of writesByTarget) {
    const prepared = prepareLayoutTarget(plan.container, target, () => {
      const staged = new Map<string, FileDraft>()
      const anchors = new Set<string>()
      for (const write of writes) {
        const { sourceLocation, fileName } = write
        if (!target.isConnected || (target !== plan.container && target.parentElement !== plan.container) || target.dataset.loc !== sourceLocation) {
          throw new Error('布局目标已变化，请重新选择容器')
        }
        let draft = staged.get(fileName)
        if (!draft) {
          const original = readFile(write)
          // Less 规则查找可能修改嵌套对象，隔离当前节点，失败不泄露已准备的部分属性。
          draft = original.kind === 'less'
            ? { ...original, css: JSON.parse(JSON.stringify(original.css)) }
            : { ...original, replacements: [...original.replacements] }
          staged.set(fileName, draft)
        }
        if (write.kind === 'jsx-inline') {
          if (draft.kind !== 'jsx-inline' || anchors.has(anchorKey(write)) || (anchorTargets.get(anchorKey(write))?.size || 0) > 1) {
            throw new Error('同一 JSX 节点存在重复写入')
          }
          anchors.add(anchorKey(write))
          const anchor = reader.resolve(target)
          if (!anchor || anchor.fileName !== fileName || anchor.originalOpening !== write.anchor.originalOpening ||
            anchor.openingStart !== write.anchor.openingStart) throw new Error('JSX 源码已变化，请重新选择容器')
          draft.replacements.push(...prepareLayoutInlineWrite(write, reader))
        } else {
          // 规划已验证实际 selector 的匹配范围；Less 写回不再依赖编辑器的 selector 打标。
          if (draft.kind !== 'less' || !write.selector || write.selector === 'inline' ||
            resolveLayoutStyleFile(target, files, entryFileName) !== fileName) {
            throw new Error('布局元素的 Less 来源已变化，请重新选择容器')
          }
          const rule = resolveRule(draft.css, write.selector, target)
          for (const [key, value] of Object.entries(write.style)) {
            const property = convertHyphenToCamel(key)
            // 调整声明顺序，使新的 longhand 覆盖原先的 shorthand。
            delete rule[property]
            if (value != null) rule[property] = value
          }
        }
      }
      return staged
    })
    prepared?.forEach((draft, fileName) => drafts.set(fileName, draft))
  }
  return Array.from(drafts.values(), draft => {
    const { fileName, previous } = draft
    if (draft.kind === 'less') return { fileName, previous, current: stringifyLess(draft.css) }
    const current = applyLayoutReplacements(previous, draft.replacements)
    // 生成结果自身有语法/范围错误时仍停止提交，不写入损坏源码。
    createLayoutJsxReader([{ fileName, source: encodeURIComponent(current) }]).read(fileName)
    return { fileName, previous, current, replacements: draft.replacements }
  })
}
