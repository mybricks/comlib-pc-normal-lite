import context from '../../context'
import { undoRedoManager } from '../undoRedo'
import { randomUUID } from '../../utils/uuid'
import { buildElementMoveChipData, getElementLabel } from './elementChip'
import {
  createDOMSourceLocationSnapshot,
  restoreDOMSourceLocationSnapshot,
  shiftElementSourceLocationByDelta,
  type SourceRange,
} from './sourceLocation'

/**
 * 按 data-loc 提供的源码范围，将 from 片段移动到 to 片段的前面或后面。
 * 不依赖文本全局搜索，避免相同 JSX 出现在注释、字符串或重复结构时替换到错误位置。
 */
const moveRangeInSource = (
  source: string,
  fromRange: SourceRange,
  toRange: SourceRange,
  type: 'before' | 'after',
): string | null => {
  if (
    !Number.isInteger(fromRange.start) ||
    !Number.isInteger(fromRange.end) ||
    !Number.isInteger(toRange.start) ||
    !Number.isInteger(toRange.end) ||
    fromRange.start < 0 ||
    fromRange.end <= fromRange.start ||
    toRange.end <= toRange.start ||
    fromRange.end > source.length ||
    toRange.end > source.length ||
    (fromRange.start < toRange.start && fromRange.end > toRange.start) ||
    (toRange.start < fromRange.start && toRange.end > fromRange.start)
  ) {
    return null
  }

  if (fromRange.start < toRange.start) {
    const fromSnippet = source.slice(fromRange.start, fromRange.end)
    const middle = source.slice(fromRange.end, toRange.start)
    const toSnippet = source.slice(toRange.start, toRange.end)
    return type === 'before'
      ? source.slice(0, fromRange.start) + middle + fromSnippet + source.slice(toRange.start)
      : source.slice(0, fromRange.start) + middle + toSnippet + fromSnippet + source.slice(toRange.end)
  }

  const toSnippet = source.slice(toRange.start, toRange.end)
  const middle = source.slice(toRange.end, fromRange.start)
  const fromSnippet = source.slice(fromRange.start, fromRange.end)
  return type === 'before'
    ? source.slice(0, toRange.start) + fromSnippet + toSnippet + middle + source.slice(fromRange.end)
    : source.slice(0, toRange.end) + fromSnippet + middle + source.slice(fromRange.end)
}

const isLocInRange = (loc: any, fileName: string, range: SourceRange) => {
  const start = loc?.jsx?.start
  const end = loc?.jsx?.end
  return (
    loc?.files?.jsx === fileName &&
    typeof start === 'number' &&
    typeof end === 'number' &&
    start >= range.start &&
    end <= range.end
  )
}

/**
 * 根据一次 JSX 片段移动，计算某个 data-loc 应该平移多少字符。
 *
 * 这里不能简单只更新 from/to 两个根节点：
 * 1. 被移动的 JSX 子树自身会移动到目标位置；
 * 2. 夹在 from 和 to 之间的同级节点源码位置也会整体前移或后移；
 * 3. 两个片段外部的节点不受影响，delta 为 0。
 *
 * 约定：fromRange/toRange 是移动前源码中的两个 JSX 根节点范围。
 * 快速路径使用 noUpdateFileSystem 更新源码，不会立即重新渲染 DOM，
 * 因此必须同步平移当前 DOM 上的 data-loc，否则再次拖动时会按旧位置截取源码，导致字符串无法匹配。
 */
const getMoveDelta = (
  loc: any,
  fileName: string,
  fromRange: SourceRange,
  toRange: SourceRange,
  type: 'before' | 'after',
) => {
  if (fromRange.start === toRange.start) return 0
  const fromLength = fromRange.end - fromRange.start
  const fromBeforeTo = fromRange.start < toRange.start
  const movedRange = fromBeforeTo ? fromRange : toRange
  const targetRange = fromBeforeTo ? toRange : fromRange

  if (isLocInRange(loc, fileName, fromRange)) {
    if (fromBeforeTo) {
      return type === 'before'
        ? toRange.start - fromLength - fromRange.start
        : toRange.end - fromLength - fromRange.start
    }
    return (type === 'before' ? toRange.start : toRange.end) - fromRange.start
  }

  if (isLocInRange(loc, fileName, toRange)) {
    if (fromBeforeTo) {
      return type === 'before' ? 0 : -fromLength
    }
    return type === 'before' ? fromLength : 0
  }

  if (
    loc?.files?.jsx === fileName &&
    typeof loc?.jsx?.start === 'number' &&
    typeof loc?.jsx?.end === 'number' &&
    loc.jsx.start >= movedRange.end &&
    loc.jsx.end <= targetRange.start
  ) {
    return fromBeforeTo ? -fromLength : fromLength
  }

  // Nodes after the target keep their absolute position because the source length is unchanged.
  return 0
}

/**
 * 将移动影响范围内的 DOM 定位信息同步到新的源码位置。
 *
 * root 取两个拖拽元素的共同父节点：
 * - 快速路径已经要求 from/to 是同一个 parentElement；
 * - 因此扫描该父节点下的 data-loc，就能覆盖被移动节点以及中间受位移影响的兄弟节点；
 * - 不扫描全局 DOM，避免误改其它组件实例或同名页面中的节点。
 *
 * 这里只做位置平移，不重算 codeLine：
 * - data-loc 与 data-style-info 的绝对偏移会被同步，供后续字符串截取、样式注入、文本编辑使用；
 * - codeLine 需要 AST/源码重新解析才能准确计算，手动推断容易生成不可信行号。
 */
const shiftDOMLocAfterSourceMove = (
  root: Element | null,
  fileName: string,
  fromRange: SourceRange,
  toRange: SourceRange,
  type: 'before' | 'after',
) => {
  if (!root) return

  const elements = [root, ...Array.from(root.querySelectorAll('[data-loc]'))]
  elements.forEach((ele) => {
    const locValue = ele.getAttribute('data-loc')
    if (!locValue) return

    try {
      const loc = JSON.parse(locValue)
      const delta = getMoveDelta(loc, fileName, fromRange, toRange, type)
      if (delta === 0) return

      shiftElementSourceLocationByDelta(ele, delta)
    } catch { }
  })
}

const restoreDOMNodePosition = (ele: Element, parent: Node | null, nextSibling: Node | null) => {
  if (!parent) return
  parent.insertBefore(ele, nextSibling?.parentNode === parent ? nextSibling : null)
}

const moveDOMNode = (fromEle: Element, toEle: Element, type: 'before' | 'after') => {
  const parent = toEle.parentNode
  if (!parent) return
  parent.insertBefore(fromEle, type === 'before' ? toEle : toEle.nextSibling)
}

const buildMoveDescription = (fromLabel: string, toLabel: string, type: 'before' | 'after') => {
  return `移动 ${fromLabel} 的位置`
  // return `将 ${fromLabel} 移到 ${toLabel}${type === 'before' ? '前' : '后'}`
}

const changeOrder = (options) => {
  const { fromEle, toEle, type } = options
  // console.log('[changeOrder]', options)
  if (fromEle === toEle) {
    // 相对自己移动，无需处理
    return
  }

  const fromDataLoc = fromEle.getAttribute('data-loc')
  let fromDOM = fromEle

  let useAI = false

  if (!fromDataLoc) {
    // 说明这个dom元素是在某段JSX的内部实现
    // 找到实现它的组件dom，这里有代码信息 loc
    fromDOM = fromEle.closest('[data-loc]')
    // 此时一定是走AI了
    useAI = true
  }

  const toDataLoc = toEle.getAttribute('data-loc')
  let toDOM = toEle

  if (!toDataLoc) {
    // 说明这个dom元素是在某段JSX的内部实现
    // 找到实现它的组件dom，这里有代码信息 loc
    toDOM = toEle.closest('[data-loc]')
    // 此时一定是走AI了
    useAI = true
  }

  // 判断 1：fromEle 和 toEle 的 parent 节点不是同一个 DOM，走 AI
  if (fromEle.parentElement !== toEle.parentElement) {
    useAI = true
  }

  // 判断 2：先用 getAttribute 查 data-widget-name，没有则用 closest 查
  // 如果两者的 data-widget-name 不同，走 AI
  const getWidgetName = (el: HTMLElement): string | null => {
    return el.getAttribute('data-widget-name') ?? el.closest('[data-widget-name]')?.getAttribute('data-widget-name') ?? null
  }
  if (getWidgetName(fromEle) !== getWidgetName(toEle)) {
    useAI = true
  }

  const fromLoc = JSON.parse(fromDOM.getAttribute('data-loc')!)
  const toLoc = JSON.parse(toDOM.getAttribute('data-loc')!)

  const fromFile = fromLoc.files?.jsx ?? ''
  const toFile = toLoc.files?.jsx ?? ''

  // 判断 3：两个元素对应的 jsx 文件不是同一个，走 AI
  if (fromFile !== toFile) {
    useAI = true
  }

  // 判断 4：fromLoc 和 toLoc 的原始字符串相同（如 map 渲染的列表项），走 AI
  if (fromDOM.getAttribute('data-loc') === toDOM.getAttribute('data-loc')) {
    useAI = true
  }

  const files: Array<{ fileName: string; source: string }> = context.component!.params.data.files ?? []
  // ─── 快速路径：不走 AI，直接替换 ─────────────────────────────────────
  // 条件：
  //   1. 两个元素都直接有 data-loc（fromDOM === fromEle && toDOM === toEle）
  //   2. 在同一个文件内
  //   3. data-loc.swappable === true（由 babelPlugin 在 AST 阶段精确计算）
  //      - 非变量赋值右值（const h1 = <h1>）
  //      - children 中无 JSXExpressionContainer（{h1}、{items.map(...)} 等）
  const fileEntry = files.find((f) => f.fileName === fromFile)
  const source = fileEntry ? decodeURIComponent(fileEntry.source) : ''

  if (
    !useAI &&
    fromFile === toFile &&
    fromLoc.swappable === true &&
    toLoc.swappable === true
  ) {
    if (fileEntry) {
      const fromRange = {
        start: fromLoc.jsx?.start,
        end: fromLoc.jsx?.end,
      }
      const toRange = {
        start: toLoc.jsx?.start,
        end: toLoc.jsx?.end,
      }
      const placement = type === 'before' ? 'before' : 'after'
      const newSource = moveRangeInSource(source, fromRange, toRange, placement)
      if (newSource !== null) {
        const locSnapshotRoot = fromEle.parentElement
        // execute 会直接更新当前 DOM 上的定位信息；undo 时必须还原移动前快照，
        // 否则源码已回退但 DOM 仍保留移动后的 data-loc，再次操作仍会错位。
        const locSnapshot = createDOMSourceLocationSnapshot(locSnapshotRoot, fromFile)

        const fromParent = fromEle.parentNode
        const fromNextSibling = fromEle.nextSibling
        const toParent = toEle.parentNode
        const toNextSibling = toEle.nextSibling
        const fromLabel = getElementLabel(fromEle, '节点1')
        const toLabel = getElementLabel(toEle, '节点2')
        const moveDescription = buildMoveDescription(fromLabel, toLabel, type)
        const actionId = randomUUID()

        undoRedoManager.executeBranch({
          execute() {
            context.updateFile({ fileName: fromFile, content: newSource, type: undefined, noUpdateFileSystem: true })
            // noUpdateFileSystem 不触发完整重渲染，必须同步节点顺序和源码定位。
            moveDOMNode(fromEle, toEle, placement)
            shiftDOMLocAfterSourceMove(locSnapshotRoot, fromFile, fromRange, toRange, placement)
            context.component!.actions.addUserAction({
              id: actionId,
              type: 'move',
              title: moveDescription,
              refElement: fromEle,
            })
          },
          undo() {
            context.updateFile({ fileName: fromFile, content: source, type: undefined, noUpdateFileSystem: true })
            restoreDOMNodePosition(fromEle, fromParent, fromNextSibling)
            restoreDOMNodePosition(toEle, toParent, toNextSibling)
            restoreDOMSourceLocationSnapshot(locSnapshot)
            context.component!.actions.removeUserAction(actionId)
          },
        })
        return {
          type: 'success',
          actionId,
        }
      }
    }
  }

  const fromLabel = getElementLabel(fromEle, '节点1')
  const toLabel = getElementLabel(toEle, '节点2')
  const placement = type === 'before' ? 'before' : 'after'

  const moveDescription = buildMoveDescription(fromLabel, toLabel, type)

  const chip = {
    id: randomUUID(),
    type: 'element-move',
    label: moveDescription,
    data: buildElementMoveChipData(fromEle, toEle, placement, fromLabel, toLabel),
  }
  const actionId = randomUUID()
  const fromParent = fromEle.parentNode
  const fromNextSibling = fromEle.nextSibling

  undoRedoManager.executeBranch({
    aiRequest: {
      message: `[[chip:${chip.id}]]`,
      chips: [chip],
    },
    execute() {
      // AI 修改尚未回写源码，不能更新 data-loc 等源码定位属性。
      moveDOMNode(fromEle, toEle, placement)
      context.component!.actions.addUserAction({
        id: actionId,
        type: 'move',
        title: moveDescription,
        refElement: fromEle,
      })
    },
    undo() {
      restoreDOMNodePosition(fromEle, fromParent, fromNextSibling)
      context.component!.actions.removeUserAction(actionId)
    },
  })

  return { type: 'success' }
}

export default changeOrder
