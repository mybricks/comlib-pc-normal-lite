import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'

const source = await readFile(new URL('../src/mix/understand-any/diagram/ui-selector.ts', import.meta.url), 'utf8')
const { uiAnchorsToSelector, findUiMatches, getUiDocuments, buildNodeHints } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)

test('builds one data-loc selector for each UI anchor', () => {
  const selector = uiAnchorsToSelector([
    { file: 'src/Order.tsx', tag: 'span', startLine: 42, endLine: 42 },
    { file: 'src/Order.tsx', tag: 'Button', startLine: 51, endLine: 55 },
  ])
  for (const [start, end] of [[42, 42], [51, 55]]) {
    assert.ok(selector.includes(`[data-loc*='src/Order.tsx'][data-loc*='"codeLine":{"start":${start},"end":${end}}']`))
  }
  assert.equal(selector.split(', ').length, 2)
  assert.equal(uiAnchorsToSelector([]), '')
})

test('escapes paths as JSON then as CSS attribute strings', () => {
  const file = `src/it's"Card.tsx`
  const selector = uiAnchorsToSelector([{ file, tag: 'div', startLine: 1, endLine: 2 }])
  const escaped = JSON.stringify(file).slice(1, -1).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  assert.ok(selector.startsWith(`[data-loc*='${escaped}']`))
})

test('finds matching nodes in nested open shadows and accessible frames', () => {
  const target = { tagName: 'DIV', shadowRoot: null }
  const nestedShadow = { querySelectorAll: selector => selector === '*' ? [target] : [target] }
  const nestedHost = { tagName: 'DIV', shadowRoot: nestedShadow }
  const outerShadow = { querySelectorAll: selector => selector === '*' ? [nestedHost] : [] }
  const host = { tagName: 'DIV', shadowRoot: outerShadow }
  const frameTarget = { tagName: 'SPAN', shadowRoot: null }
  const frameDocument = { querySelectorAll: selector => selector === '*' ? [frameTarget] : [frameTarget] }
  const frame = { tagName: 'IFRAME', shadowRoot: null, contentDocument: frameDocument }
  const crossOrigin = { tagName: 'IFRAME', shadowRoot: null, get contentDocument() { throw new Error('cross-origin') } }
  const doc = { querySelectorAll: selector => selector === '*' ? [host, frame, crossOrigin] : [] }
  assert.deepEqual(new Set(findUiMatches(doc, '[data-loc]')), new Set([target, frameTarget]))
})

test('data nodes aggregate and deduplicate UI locations across downstream fields', () => {
  const anchor = line => ({ file: 'src/Order.tsx', tag: 'span', startLine: line, endLine: line })
  const diagram = { kind: 'flowchart', direction: 'LR', nodes: [
    { id: 'api', source: { bind: 'GET /orders' } },
    { id: 'total', field: { bind: 'total' } },
    { id: 'discount', field: { bind: 'discount' }, ui: [anchor(30)] },
    { id: 'payable', field: { bind: 'payableAmount' }, ui: [anchor(42), anchor(55), anchor(55)] },
    { id: 'open', field: { bind: 'open' }, ui: [anchor(80)] },
    { id: 'empty', field: { bind: 'empty' } },
  ], edges: [{ source: 'api', target: 'total' }, { source: 'api', target: 'discount' },
    { source: 'total', target: 'payable' }, { source: 'discount', target: 'payable' },
    { source: 'payable', target: 'total' }] }
  const hints = buildNodeHints(diagram)
  const selectors = id => new Set([hints.get(id).selector].flat())
  assert.deepEqual(selectors('total'), new Set([uiAnchorsToSelector([anchor(42)]), uiAnchorsToSelector([anchor(55)])]))
  assert.deepEqual(selectors('discount'), new Set([uiAnchorsToSelector([anchor(30)]), uiAnchorsToSelector([anchor(42)]), uiAnchorsToSelector([anchor(55)])]))
  assert.deepEqual(selectors('api'), selectors('discount'))
  assert.equal(hints.get('api').title, 'GET /orders')
  assert.equal(hints.get('total').title, 'total')
  assert.equal(hints.get('payable').title, 'payableAmount')
  assert.deepEqual(hints.get('open'), { selector: uiAnchorsToSelector([anchor(80)]), title: 'open' })
  assert.equal(hints.has('empty'), false)
})

test('outside-click listeners include documents in open shadow roots and same-origin frames', () => {
  const inside = { querySelectorAll: () => [] }
  const frame = { tagName: 'IFRAME', shadowRoot: null, contentDocument: inside }
  const shadow = { querySelectorAll: () => [frame] }
  const host = { tagName: 'DIV', shadowRoot: shadow }
  const inaccessible = { tagName: 'IFRAME', shadowRoot: null, get contentDocument() { throw new Error('cross-origin') } }
  const root = { querySelectorAll: () => [host, inaccessible] }
  assert.deepEqual(new Set(getUiDocuments(root)), new Set([root, inside]))
})
