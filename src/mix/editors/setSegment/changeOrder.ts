import context from '../../context'
import { undoRedoManager } from '../undoRedo'
import { randomUUID } from '../../utils/uuid'
import { buildElementMoveChipData, getElementLabel } from './elementChip'

const getSnippet = (fileName: string, loc: any, files): string => {
  const file = files.find((f) => f.fileName === fileName)
  if (!file) return ''
  const source = decodeURIComponent(file.source)
  const start: number = loc.jsx?.start ?? 0
  const end: number = loc.jsx?.end ?? source.length
  return source.slice(start, end).trim()
}

/**
 * 直接用字符串替换交换源码中两段 JSX 节点的位置。
 * 要求：fromSnippet 和 toSnippet 在 source 中各自只出现一次，且均为纯净 JSX。
 *
 * 返回替换后的新 source，若失败返回 null。
 */
const swapSnippetsInSource = (source: string, fromSnippet: string, toSnippet: string): string | null => {
  // 用占位符避免先替换 A 后找不到 B 的问题
  const PLACEHOLDER_A = `__SWAP_PLACEHOLDER_A_${Date.now()}__`
  const PLACEHOLDER_B = `__SWAP_PLACEHOLDER_B_${Date.now()}__`

  if (!source.includes(fromSnippet) || !source.includes(toSnippet)) {
    return null
  }
  let result = source
  result = result.replace(fromSnippet, PLACEHOLDER_A)
  result = result.replace(toSnippet, PLACEHOLDER_B)
  result = result.replace(PLACEHOLDER_A, toSnippet)
  result = result.replace(PLACEHOLDER_B, fromSnippet)
  return result
}

type SourceRange = {
  start: number
  end: number
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

const shiftElementJSONAttribute = (ele: Element, attrName: string, delta: number) => {
  const value = ele.getAttribute(attrName)
  if (!value) return

  try {
    // data-zone-text-editable 等属性内部也是 JSON，且记录的是源码绝对位置。
    // 当 JSX 子树整体移动时，这类属性需要与 data-loc 使用同一个 delta 平移，
    // 否则后续文本编辑会继续使用旧 start/end 定位。
    ele.setAttribute(attrName, JSON.stringify(shiftLocByDelta(JSON.parse(value), delta)))
  } catch { }
}

/**
 * 根据一次 JSX 片段交换，计算某个 data-loc 应该平移多少字符。
 *
 * 这里不能简单只更新 from/to 两个根节点：
 * 1. 被交换的两个 JSX 子树自身会移动到对方位置；
 * 2. 如果两个片段长度不同，夹在两者之间的同级节点源码位置也会整体前移或后移；
 * 3. 两个片段外部的节点不受影响，delta 为 0。
 *
 * 约定：firstRange/secondRange 是交换前源码中的两个 JSX 根节点范围，
 * 函数内部先按 start 排出 left/right，再根据 loc 所在区间返回应平移的 delta。
 * 快速路径使用 noUpdateFileSystem 更新源码，不会立即重新渲染 DOM，
 * 因此必须同步平移当前 DOM 上的 data-loc，否则再次拖动时会按旧位置截取源码，导致字符串无法匹配。
 */
const getSwapDelta = (loc: any, fileName: string, firstRange: SourceRange, secondRange: SourceRange) => {
  if (firstRange.start === secondRange.start) return 0

  const leftRange = firstRange.start < secondRange.start ? firstRange : secondRange
  const rightRange = firstRange.start < secondRange.start ? secondRange : firstRange
  const leftLength = leftRange.end - leftRange.start
  const rightLength = rightRange.end - rightRange.start

  if (isLocInRange(loc, fileName, leftRange)) {
    // 左侧片段被移动到右侧片段原位置之后。
    // 目标起点 = rightRange.end - leftLength。
    return rightRange.end - leftLength - leftRange.start
  }

  if (isLocInRange(loc, fileName, rightRange)) {
    // 右侧片段被移动到左侧片段原位置。
    return leftRange.start - rightRange.start
  }

  if (
    loc?.files?.jsx === fileName &&
    typeof loc?.jsx?.start === 'number' &&
    typeof loc?.jsx?.end === 'number' &&
    loc.jsx.start >= leftRange.end &&
    loc.jsx.end <= rightRange.start
  ) {
    // 中间区间会被右侧片段替换到左侧后产生的长度差整体平移。
    // 例如左片段更短，则中间节点向右移动；左片段更长，则中间节点向左移动。
    return rightLength - leftLength
  }

  return 0
}

/**
 * 将交换影响范围内的 DOM 定位信息同步到新的源码位置。
 *
 * root 取两个拖拽元素的共同父节点：
 * - 快速路径已经要求 from/to 是同一个 parentElement；
 * - 因此扫描该父节点下的 data-loc，就能覆盖被交换节点以及中间受位移影响的兄弟节点；
 * - 不扫描全局 DOM，避免误改其它组件实例或同名页面中的节点。
 *
 * 这里只做位置平移，不重算 codeLine：
 * - start/end/tag.end 是后续字符串截取、样式注入、文本编辑真正依赖的绝对偏移；
 * - codeLine 需要 AST/源码重新解析才能准确计算，手动推断容易生成不可信行号。
 */
const shiftDOMLocAfterSourceSwap = (root: Element | null, fileName: string, firstRange: SourceRange, secondRange: SourceRange) => {
  if (!root) return

  const elements = [root, ...Array.from(root.querySelectorAll('[data-loc]'))]
  elements.forEach((ele) => {
    const locValue = ele.getAttribute('data-loc')
    if (!locValue) return

    try {
      const loc = JSON.parse(locValue)
      const delta = getSwapDelta(loc, fileName, firstRange, secondRange)
      if (delta === 0) return

      ele.setAttribute('data-loc', JSON.stringify(shiftLocByDelta(loc, delta)))
      shiftElementJSONAttribute(ele, 'data-zone-text-editable', delta)
    } catch { }
  })
}

const restoreDOMAttribute = (ele: Element | null, attrName: string, value: string | null) => {
  if (!ele) return
  if (value == null) {
    ele.removeAttribute(attrName)
  } else {
    ele.setAttribute(attrName, value)
  }
}

const restoreDOMLocSnapshot = (root: Element | null, snapshot: Map<Element, { loc: string | null; textEditable: string | null }>) => {
  if (!root) return

  const elements = [root, ...Array.from(root.querySelectorAll('[data-loc]'))]
  elements.forEach((ele) => {
    const item = snapshot.get(ele)
    if (!item) return

    restoreDOMAttribute(ele, 'data-loc', item.loc)
    restoreDOMAttribute(ele, 'data-zone-text-editable', item.textEditable)
  })
}

const createDOMLocSnapshot = (root: Element | null) => {
  const snapshot = new Map<Element, { loc: string | null; textEditable: string | null }>()
  if (!root) return snapshot

  const elements = [root, ...Array.from(root.querySelectorAll('[data-loc]'))]
  elements.forEach((ele) => {
    snapshot.set(ele, {
      loc: ele.getAttribute('data-loc'),
      textEditable: ele.getAttribute('data-zone-text-editable'),
    })
  })

  return snapshot
}

const swapDOMNodes = (fromEle: Element, toEle: Element) => {
  const parent = fromEle.parentNode
  if (!parent || parent !== toEle.parentNode) return

  const fromNext = fromEle.nextSibling
  const toNext = toEle.nextSibling

  if (fromNext === toEle) {
    parent.insertBefore(toEle, fromEle)
    return
  }
  if (toNext === fromEle) {
    parent.insertBefore(fromEle, toEle)
    return
  }

  parent.insertBefore(fromEle, toNext)
  parent.insertBefore(toEle, fromNext)
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
  const fromSnippet = getSnippet(fromFile, fromLoc, files)
  const toSnippet = getSnippet(toFile, toLoc, files)

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
      const newSource = swapSnippetsInSource(source, fromSnippet, toSnippet)
      if (newSource !== null) {
        const fromRange = {
          start: fromLoc.jsx.start,
          end: fromLoc.jsx.end,
        }
        const toRange = {
          start: toLoc.jsx.start,
          end: toLoc.jsx.end,
        }
        const locSnapshotRoot = fromEle.parentElement
        // execute 会直接更新当前 DOM 上的定位信息；undo 时必须还原交换前快照，
        // 否则源码已回退但 DOM 仍保留交换后的 data-loc，再次操作仍会错位。
        const locSnapshot = createDOMLocSnapshot(locSnapshotRoot)

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
            swapDOMNodes(fromEle, toEle)
            shiftDOMLocAfterSourceSwap(locSnapshotRoot, fromFile, fromRange, toRange)
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
            restoreDOMLocSnapshot(locSnapshotRoot, locSnapshot)
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
