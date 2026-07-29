import context from '../../context'
import { undoRedoManager } from '../undoRedo'
import { randomUUID } from '../../utils/uuid'

const getSnippet = (fileName: string, loc: any, files): string => {
  const file = files.find((f) => f.fileName === fileName)
  if (!file) return ''
  const source = decodeURIComponent(file.source)
  const start: number = loc.jsx?.start ?? 0
  const end: number = loc.jsx?.end ?? source.length
  return source.slice(start, end).trim()
}

/**
 * 将 DOM 元素序列化为简洁的 HTML 结构字符串，最多展开 maxDepth 层。
 * 过滤掉平台注入的 data-* 属性，保留 class / id / type 等有语义的属性。
 */
const serializeDOMShallow = (ele: Element, maxDepth: number, depth = 0): string => {
  const tag = ele.tagName.toLowerCase()
  const attrs = Array.from(ele.attributes)
    .filter((a) => !a.name.startsWith('data-'))
    .map((a) => `${a.name}="${a.value}"`)
    .join(' ')
  const openTag = attrs ? `<${tag} ${attrs}>` : `<${tag}>`

  if (depth >= maxDepth) {
    // 到达深度上限，只输出文本内容（截断）
    const text = ele.textContent?.trim().slice(0, 40) ?? ''
    return text ? `${openTag}${text}</${tag}>` : `<${tag} />`
  }

  const childNodes = Array.from(ele.childNodes)
  const childParts: string[] = []
  for (const node of childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) childParts.push(text)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const indent = '  '.repeat(depth + 1)
      childParts.push(indent + serializeDOMShallow(node as Element, maxDepth, depth + 1))
    }
  }

  if (!childParts.length) return `<${tag} />`
  const indent = '  '.repeat(depth)
  return `${openTag}\n${childParts.join('\n')}\n${indent}</${tag}>`
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
        undoRedoManager.execute({
          execute() {
            context.updateFile({ fileName: fromFile, content: newSource, type: undefined })
            context.saveManualVersion([fromFile])
          },
          undo() {
            context.updateFile({ fileName: fromFile, content: source, type: undefined })
            context.saveManualVersion([fromFile])
          },
        })
        return {
          type: 'success'
        }
      }
    }
  }

  const componentId = context.component!.params.id
  const fromLabel = fromEle?.dataset?.zoneTitle?.slice(1) || fromEle?.classList?.[0] || fromEle?.tagName?.toLowerCase?.() || '节点1'
  const toLabel = toEle?.dataset?.zoneTitle?.slice(1) || toEle?.classList?.[0] || toEle?.tagName?.toLowerCase?.() || '节点2'

  const chip = {
    id: randomUUID(),
    type: 'element-move',
    label: `将 ${fromLabel} 移到 ${toLabel} ${type === 'before' ? '前面' : '后面'}`,
    data: {
      fromEle,
      toEle,
      placement: type === 'before' ? 'before' : 'after',
      fromLabel,
      toLabel,
    },
  }

  window._sandbox_.helpers.appendToSender(componentId, {
    message: `[[chip:${chip.id}]]`,
    meta: {
      chips: [chip],
    },
    animation: true
  })

  context.chipPromiseIds.add(chip.id)

  return {
    type: 'promise',
    promiseId: chip.id
  }
}

export default changeOrder
