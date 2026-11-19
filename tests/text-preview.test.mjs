import test from 'node:test'
import assert from 'node:assert/strict'
import { createTextPreview } from '../src/mix/editors/setSegment/textPreview.ts'

// Strict DOM model: preserve identity and enforce anchor/parent checks.
class DomNode {
  constructor(type, value) {
    this.nodeType = type
    this.data = type === 1 ? undefined : value
    this.tagName = type === 1 ? value.toUpperCase() : undefined
    this.parentNode = null
    this.childNodes = []
    this.ownerDocument = document
  }
  get textContent() {
    return this.nodeType === 1 ? this.childNodes.filter(n => n.nodeType !== 8).map(n => n.textContent).join('') : this.data
  }
  get firstChild() { return this.childNodes[0] ?? null }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)) }
  insertBefore(node, anchor) {
    assert.ok(anchor === null || this.childNodes.includes(anchor))
    if (node === anchor) return node
    if (node.parentNode) node.parentNode.removeChild(node)
    this.childNodes.splice(anchor === null ? this.childNodes.length : this.childNodes.indexOf(anchor), 0, node)
    node.parentNode = this
    return node
  }
  removeChild(node) {
    assert.equal(node.parentNode, this)
    this.childNodes.splice(this.childNodes.indexOf(node), 1)
    node.parentNode = null
    return node
  }
  replaceChild(next, old) { this.insertBefore(next, old); return this.removeChild(old) }
}
const document = {
  createTextNode: text => new DomNode(3, text),
  createElement: tag => new DomNode(1, tag),
  createComment: text => new DomNode(8, text),
}
const text = value => document.createTextNode(value)
const el = (tag, ...children) => {
  const node = document.createElement(tag)
  children.forEach(child => node.insertBefore(child, null))
  return node
}
const renderedText = node => node.nodeType === 3 ? node.data : node.nodeType === 8 ? '' :
  node.tagName === 'BR' ? '\n' : ['SCRIPT', 'STYLE', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT'].includes(node.tagName) ? '' :
    Array.from(node.childNodes).map(renderedText).join('')

function checkRoundTrip(root, next, verify = () => {}) {
  const snapshot = []
  function visit(node) {
    snapshot.push([node, Array.from(node.childNodes), node.data])
    Array.from(node.childNodes).forEach(visit)
  }
  visit(root)
  const command = createTextPreview(root, next)
  for (let i = 0; i < 2; i++) {
    command.execute()
    command.execute() // Repeated execute must be harmless.
    assert.equal(renderedText(root), next.replace(/\r\n?/g, '\n'))
    verify()
    command.undo()
    command.undo()
    for (const [node, children, data] of snapshot) {
      assert.deepEqual(Array.from(node.childNodes), children)
      assert.equal(node.data, data)
    }
  }
}

test('preserves image and original text identity, literal characters and multiline content', () => {
  const original = text('helloworld')
  const image = el('img')
  image.runtimeState = { loaded: true }
  const root = el('span', original, image)
  checkRoundTrip(root, '<hello>&{world}\nnext', () => {
    assert.equal(root.firstChild, original)
    assert.equal(image.parentNode, root)
    assert.equal(image.runtimeState.loaded, true)
  })
})

test('updates nested text without duplicate content or rebuilding formatting elements', () => {
  const bold = el('b', text('world'))
  const root = el('span', text('hello '), bold)
  checkRoundTrip(root, 'new text', () => assert.equal(bold.parentNode, root))
  const nested = el('span', el('em', text('only nested text')))
  checkRoundTrip(nested, 'replacement\nsecond line')
})

test('keeps unchanged text on both sides of an image and edits inside its original wrapper', () => {
  const before = text('before')
  const image = el('img')
  const after = el('b', text('after'))
  const root = el('span', before, image, after)
  checkRoundTrip(root, 'beforeAFTER', () => {
    assert.deepEqual(Array.from(root.childNodes), [before, image, after])
    assert.equal(after.textContent, 'AFTER')
  })
  checkRoundTrip(root, 'BEFOREafter', () => assert.equal(after.textContent, 'after'))
  checkRoundTrip(root, 'replacement', () => assert.deepEqual(Array.from(root.childNodes), [before, image, after]))
})

test('inserts at formatting boundaries, appends, and preserves unchanged breaks', () => {
  const bold = el('b', text('world'))
  checkRoundTrip(el('span', text('hello'), bold), 'hello world', () => assert.equal(bold.textContent, ' world'))
  const br = el('br')
  const root = el('span', text('first'), br, text('last'))
  checkRoundTrip(root, 'first\nlast!', () => assert.equal(br.parentNode, root))
  checkRoundTrip(root, 'first added\nlast', () => assert.equal(br.parentNode, root))
  checkRoundTrip(root, 'firstlast')
  checkRoundTrip(root, '\nfirst\r\nlast\n')
  const trailing = el('br')
  checkRoundTrip(el('span', text('first'), trailing), 'first\nadded', () => assert.ok(trailing.parentNode))
})

test('handles empty content, empty elements, decoration-only elements and consecutive breaks', () => {
  checkRoundTrip(el('span'), 'new\ntext')
  checkRoundTrip(el('span', el('img')), 'new')
  checkRoundTrip(el('span', text('a'), el('br'), el('br'), text('b')), '')
  checkRoundTrip(el('span', el('br')), 'new\ntext')
  checkRoundTrip(el('span', text('')), 'new')
})

test('ignores script, style and SVG icon text', () => {
  const script = el('script', text('code'))
  const style = el('style', text('css'))
  const svg = el('svg', el('title', text('icon')))
  const root = el('span', script, style, svg, text('old'))
  checkRoundTrip(root, 'new', () => {
    assert.equal(script.textContent, 'code')
    assert.equal(style.textContent, 'css')
    assert.equal(svg.textContent, 'icon')
  })
})

test('undo works when an adjacent image was removed externally', () => {
  const original = text('old')
  const image = el('img')
  const root = el('span', original, image)
  const command = createTextPreview(root, 'new')
  command.execute()
  root.removeChild(image)
  command.undo()
  assert.equal(root.textContent, 'old')
  assert.equal(image.parentNode, null)
  command.execute()
  assert.equal(root.textContent, 'new')
})

test('external rerender invalidates stale undo/redo instead of resurrecting old nodes', () => {
  const original = text('old')
  const root = el('span', original)
  const command = createTextPreview(root, 'new\nline')
  command.execute()
  for (const child of Array.from(root.childNodes)) root.removeChild(child)
  const fresh = text('framework update')
  root.insertBefore(fresh, null)
  command.undo()
  command.execute()
  assert.deepEqual(Array.from(root.childNodes), [fresh])
  assert.equal(fresh.data, 'framework update')
})

test('external changes to the same text node or inserted text are preserved', () => {
  for (const updateAddition of [false, true]) {
    const original = text('old')
    const root = el('span', original)
    const command = createTextPreview(root, 'new\nline')
    command.execute()
    const changed = updateAddition ? root.childNodes[2] : original
    changed.data = 'external'
    command.undo()
    command.execute()
    assert.equal(changed.data, 'external')
  }
})

test('consecutive edits undo and redo as a stack', () => {
  const root = el('span', text('old'), el('img'), el('b', text('tail')))
  const first = createTextPreview(root, 'new\nlinetail')
  first.execute()
  const second = createTextPreview(root, 'new\nlineTAIL')
  second.execute()
  assert.equal(renderedText(root), 'new\nlineTAIL')
  second.undo()
  first.undo()
  assert.equal(renderedText(root), 'oldtail')
  first.execute()
  second.execute()
  assert.equal(renderedText(root), 'new\nlineTAIL')
})

test('unchanged content leaves every node intact and reports no changes', () => {
  const root = el('span', text('hello'), el('br'), el('b', text('world')), el('img'))
  assert.equal(createTextPreview(root, 'hello\nworld').hasChanges, false)
  checkRoundTrip(root, 'hello\nworld')
})

test('undo of text inserted into a decoration-only element tolerates decoration removal', () => {
  const image = el('img')
  const root = el('span', image)
  const command = createTextPreview(root, 'new\ntext')
  command.execute()
  root.removeChild(image)
  command.undo()
  assert.equal(root.childNodes.length, 0)
})

test('replaced break anchors and rerenders before redo do not restore obsolete content', () => {
  const br = el('br')
  const root = el('span', text('first'), br, text('last'))
  const command = createTextPreview(root, 'firstlast')
  command.execute()
  const marker = Array.from(root.childNodes).find(node => node.nodeType === 8)
  root.replaceChild(el('img'), marker)
  command.undo()
  assert.equal(br.parentNode, null)
  const second = createTextPreview(root, 'changed')
  second.execute()
  second.undo()
  root.firstChild.data = 'external update'
  second.execute()
  assert.equal(root.firstChild.data, 'external update')
})
