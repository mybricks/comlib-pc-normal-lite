import { tryParseLess, stringifyLess } from '../../../utils/transform/less'
import { convertHyphenToCamel } from '../../../../utils/string'
import { extractLessImportsFromSource, resolveLessFilePath } from './resolveLessFilePath'
import type { LayoutStyleWrite, LayoutWritePlan } from './layoutTypes'

type FileEntry = { fileName: string; source: string }
type ResolveRule = (css: Record<string, any>, selector: string, target: HTMLElement) => Record<string, any>

/**
 * 找出一个 DOM 元素应该写入的 Less 文件，返回组件 files 列表中的文件名。
 * 优先使用编译时 data-loc.files.less 记录的路径；没有时，先找到 files.jsx 对应的源码，
 * 再依次检查：该 JSX 导入的 Less → 入口 JSX 导入的 Less → 文件列表中的所有 Less。
 *
 * 例如 components/Card/index.tsx 导入 ./index.less，就写 components/Card/index.less；
 * Card 没有自己的 Less import 时，可以使用入口文件导入的共享 Less。
 * 选定一层后必须只有一个候选；有两个 Less 时直接报错，不随意挑一个，也不继续往下一层猜。
 */
export function resolveLayoutStyleFile(target: HTMLElement, files: FileEntry[], entryFileName?: string): string {
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
    if (candidates.length !== 1) throw new Error('无法唯一确定布局元素的 Less 文件，暂不支持本次切换')
    fileName = resolveLessFilePath(candidates[0], files, entryFileName)
  }
  if (!files.some(file => file.fileName === fileName)) throw new Error('找不到布局对应的 Less 文件')
  return fileName
}

/**
 * 把 LayoutWritePlan 转成文件内容列表：[{ fileName, previous, current }, ...]。
 * previous 是修改前源码，用于撤销；current 是合并全部属性修改后的源码，用于执行和重做。
 * resolveRule 由宿主提供，负责在解析后的 Less 中找到或创建完整 selector 对应的规则。
 *
 * 这里不会调用 updateFile。先检查全部节点，再生成全部文件内容；例如第二个子组件的 Less
 * 解析失败时直接抛错，调用方拿不到更新列表，因此第一个文件也还没有被提交。
 */
export function prepareLayoutStyleChange(plan: LayoutWritePlan, files: FileEntry[], componentId: string, resolveRule: ResolveRule, entryFileName?: string) {
  if (!plan || plan.componentId !== componentId || !plan.container?.isConnected || !plan.writes?.length) {
    throw new Error('布局目标已变化，请重新选择容器')
  }
  // 再确认这些记录仍然指向原来的节点和文件。例如节点已经被重新渲染替换、
  // data-loc 已变化，或者 JSX 改为导入另一个 Less，都不能继续沿用之前算出的写入目标。
  const writesByFile = new Map<string, LayoutStyleWrite[]>()
  for (const write of plan.writes) {
    const { target, selector, sourceLocation, fileName, style } = write
    if (!target.isConnected || (target !== plan.container && target.parentElement !== plan.container) ||
      !target.dataset.zoneSelector || target.dataset.loc !== sourceLocation || !selector || selector === 'inline') {
      throw new Error('布局目标已变化或不支持直接写回，请重新选择容器')
    }
    let inline: Record<string, any>
    try { inline = JSON.parse(target.dataset.styleInfo || '{}') } catch {
      throw new Error('布局元素缺少有效的源码定位信息')
    }
    if (resolveLayoutStyleFile(target, files, entryFileName) !== fileName) {
      throw new Error('布局元素的 Less 文件已变化，请重新选择容器')
    }
    if (Object.keys(style).some(key => inline[key] || target.style.getPropertyValue(key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())))) {
      throw new Error('当前自由布局暂不支持内联定位配置')
    }
    const writes = writesByFile.get(fileName) || []
    writes.push(write)
    writesByFile.set(fileName, writes)
  }
  // 先按文件分组：index.less 中多个子元素的修改一次合并；
  // RedCard/index.less 的 .root 和 BlueCard/index.less 的 .root 分别处理，不会互相覆盖。
  return Array.from(writesByFile, ([fileName, writes]) => {
    const file = files.find(file => file.fileName === fileName)!
    const previous = decodeURIComponent(file.source)
    const css = tryParseLess(previous)
    if (!css) throw new Error(`Less 解析失败，未修改布局：${fileName}`)
    for (const { target, selector, style } of writes) {
      const rule = resolveRule(css, selector, target)
      for (const [key, value] of Object.entries(style)) {
        // parseLess 的对象 key 已转换成驼峰形式，--layout-item 这类自定义属性也不例外。
        // 删除时做同样的转换，才能删到对象中实际存储的 key，避免退出后标记残留。
        const property = convertHyphenToCamel(key)
        // 先删再写，让本次修改排到声明末尾。例如已有 flex-flow: row wrap，
        // 本次 flex-direction: column 必须排在它后面，浏览器才会使用新的方向。
        delete rule[property]
        if (value != null) rule[property] = value
      }
    }
    return { fileName, previous, current: stringifyLess(css) }
  })
}

