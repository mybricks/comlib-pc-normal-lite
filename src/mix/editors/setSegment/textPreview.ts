const SKIP_TEXT_TAGS = new Set(['script', 'style', 'template', 'noscript', 'svg', 'math'])

interface TextPart {
  node: Text | Element
  text: string
  start: number
}

// 图片和标签不参与替换。保留相同的前后文，只在发生变化的文本区间内更新。
// 纯文本输入无法表达图片两侧的分配：新增文字固定插入变化起点。
export function createTextPreview(element: Element, content: string) {
  const document = element.ownerDocument
  const parts: TextPart[] = []
  let previous = ''
  function collect(node: Node) {
    if (node.nodeType === 3) {
      const text = (node as Text).data
      parts.push({ node: node as Text, text, start: previous.length })
      previous += text
    } else if (node.nodeType === 1) {
      const child = node as Element
      if (SKIP_TEXT_TAGS.has(child.tagName.toLowerCase())) return
      if (child.tagName.toLowerCase() === 'br') {
        parts.push({ node: child, text: '\n', start: previous.length })
        previous += '\n'
      } else {
        Array.from(child.childNodes).forEach(collect)
      }
    }
  }
  collect(element)
  const next = content.replace(/\r\n?/g, '\n')
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++
  let suffix = 0
  while (suffix < previous.length - prefix && suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++
  const end = previous.length - suffix
  const inserted = next.slice(prefix, next.length - suffix)
  const target = parts.find((part) => prefix < part.start + part.text.length) ?? parts[parts.length - 1]
  const patches: Array<{ valid(applied: boolean): boolean; execute(): void; undo(): void }> = []

  for (const part of parts) {
    const from = Math.max(0, Math.min(part.text.length, prefix - part.start))
    const to = Math.max(from, Math.min(part.text.length, end - part.start))
    const value = part.text.slice(0, from) + (part === target ? inserted : '') + part.text.slice(to)
    if (value === part.text) continue
    const node = part.node
    const parent = node.parentNode!
    const isText = node.nodeType === 3
    // 被删除的 br 使用不可见锚点，撤销不再依赖可能已被重渲染移除的相邻图片。
    const anchor = isText ? node : document.createComment('text-preview')
    const lines = value.split('\n')
    const additions: Node[] = []
    const retainedBreak = !isText && from === to
      ? (from === 0 ? inserted.split('\n').length - 1 : 0)
      : -1
    lines.forEach((line, index) => {
      if (index) additions.push(index - 1 === retainedBreak ? node : document.createElement('br'))
      if (!isText || index) additions.push(document.createTextNode(line))
    })
    const expected = additions.map((child) => child.nodeType === 3 ? (child as Text).data : null)
    patches.push({
      valid(applied) {
        const current = applied ? anchor : node
        return element.contains(current) && current.parentNode === parent &&
          (!isText || (node as Text).data === (applied ? lines[0] : part.text)) &&
          (!applied || additions.every((child, index) => child.parentNode === parent &&
            (expected[index] === null || (child as Text).data === expected[index])))
      },
      execute() {
        if (isText) (node as Text).data = lines[0]
        else parent.replaceChild(anchor, node)
        const reference = anchor.nextSibling
        additions.forEach((child) => parent.insertBefore(child, reference))
      },
      undo() {
        additions.forEach((child) => parent.removeChild(child))
        if (isText) (node as Text).data = part.text
        else parent.replaceChild(node, anchor)
      },
    })
  }

  if (!parts.length && next && !SKIP_TEXT_TAGS.has(element.tagName.toLowerCase())) {
    const children = Array.from(element.childNodes)
    const additions: Node[] = []
    next.split('\n').forEach((line, index) => {
      if (index) additions.push(document.createElement('br'))
      additions.push(document.createTextNode(line))
    })
    patches.push({
      valid(applied) {
        if (!applied) {
          return children.length === element.childNodes.length &&
            children.every((node, index) => element.childNodes[index] === node)
        }
        return additions.every((node) => node.parentNode === element) &&
          additions.filter((node) => node.nodeType === 3)
            .map((node) => (node as Text).data).join('\n') === next
      },
      execute() {
        const reference = element.firstChild
        additions.forEach((node) => element.insertBefore(node, reference))
      },
      undo() { additions.forEach((node) => element.removeChild(node)) },
    })
  }

  let applied = false
  let invalidated = false
  function change(forward: boolean) {
    if (invalidated || applied === forward) return
    // 框架若已重建/改写目标文本，旧命令失效，避免污染新 DOM 或复活旧节点。
    if (!patches.every((patch) => patch.valid(applied))) {
      invalidated = true
      return
    }
    if (forward) patches.forEach((patch) => patch.execute())
    else [...patches].reverse().forEach((patch) => patch.undo())
    applied = forward
  }
  return { hasChanges: patches.length > 0, execute() { change(true) }, undo() { change(false) } }
}
