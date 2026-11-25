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

test('fields collect UI selectors and UI nodes inherit their associated field bind', () => {
  const anchor = line => ({ file: 'src/Order.tsx', tag: 'span', startLine: line, endLine: line })
  const diagram = { kind: 'mindmap', direction: 'LR', nodes: [
    { id: 'total', label: '金额', shape: 'default', field: { bind: 'total' } },
    { id: 'price', label: '金额', shape: 'default', ui: [anchor(42)] },
    { id: 'summary', label: '汇总', shape: 'default', ui: [anchor(55)] },
    { id: 'other', label: '其他字段', shape: 'default', field: { bind: 'status' } },
    { id: 'status', label: '状态', shape: 'default', ui: [anchor(80)] },
  ], edges: [
    { source: 'total', target: 'price' }, { source: 'total', target: 'summary' },
    { source: 'total', target: 'other' }, { source: 'other', target: 'status' },
  ] }
  const hints = buildNodeHints(diagram)
  assert.deepEqual(hints.get('total'), { selector: [uiAnchorsToSelector([anchor(42)]), uiAnchorsToSelector([anchor(55)])], title: 'total' })
  assert.deepEqual(hints.get('price'), { selector: uiAnchorsToSelector([anchor(42)]), title: 'total' })
  assert.deepEqual(hints.get('status'), { selector: uiAnchorsToSelector([anchor(80)]), title: 'status' })
  assert.equal(hints.has('missing'), false)
})

test('field traversal handles cycles, empty UI, and duplicate locations', () => {
  const ui = { file: 'src/A.tsx', tag: 'div', startLine: 3, endLine: 3 }
  const diagram = { kind: 'flowchart', direction: 'LR', nodes: [
    { id: 'f', field: { bind: 'value' } }, { id: 'step' },
    { id: 'a', ui: [ui] }, { id: 'b', ui: [ui] }, { id: 'empty', field: { bind: 'empty' } },
  ], edges: [{ source: 'f', target: 'step' }, { source: 'step', target: 'f' },
    { source: 'step', target: 'a' }, { source: 'step', target: 'b' }] }
  const hints = buildNodeHints(diagram)
  assert.deepEqual(hints.get('f'), { selector: [uiAnchorsToSelector([ui])], title: 'value' })
  assert.deepEqual(hints.get('a'), { selector: uiAnchorsToSelector([ui]), title: 'value' })
  assert.deepEqual(hints.get('empty'), { selector: [], title: 'empty' })
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
