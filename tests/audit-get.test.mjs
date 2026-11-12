import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const domSource = await readFile(new URL('../src/helpers/dom/index.ts', import.meta.url), 'utf8')
// These tests only call escapeCssAttributeValue; the other DOM helpers are unused.
const domUrl = moduleUrl(stripTypeScriptTypes(domSource.replace("import { safeParseJson } from '../normal'", '')))
const auditSource = await readFile(new URL('../src/mix/context/audit.ts', import.meta.url), 'utf8')
const auditUrl = moduleUrl(stripTypeScriptTypes(auditSource, { mode: 'transform' })
  .replace('"../../helpers/dom"', JSON.stringify(domUrl)))
const { default: Audit } = await import(auditUrl)
const { escapeCssAttributeValue } = await import(domUrl)

const loc = { files: { jsx: "src/it's\\Page.tsx" }, codeLine: { start: 10, end: 12 } }
const location = { fileName: loc.files.jsx, startLine: 10, endLine: 12, tag: 'Button' }
const event = { title: 'onClick', location }
const state = [{ field: 'loading', location }]
const value = {
  events: [event, { title: 'other line', location: { ...location, startLine: 11 } },
    { title: 'other file', location: { ...location, fileName: 'Other.tsx' } }],
  services: [{ title: 'save', location }],
  state,
  store: state,
  docs: [{ title: 'Page', refSelector: '.widget' }],
}
const query = { tsx: 'Page.tsx', type: 'dom', loc: JSON.stringify(loc) }

function setup() {
  const data = {}
  const audit = new Audit({ component: { params: { data } } })
  audit.set({ tsx: query.tsx, value })
  return { audit, data }
}

test('canvas returns only requested categories for the selected TSX', () => {
  const { audit } = setup()
  assert.deepEqual(audit.get({ tsx: query.tsx, type: 'canvas', valueKeys: ['events', 'store'] }),
    { events: value.events, store: state })
  assert.deepEqual(audit.get({ tsx: 'missing', type: 'canvas', valueKeys: ['events'] }), { events: [] })
  assert.deepEqual(audit.get({ tsx: query.tsx, type: 'canvas', valueKeys: ['jsDocs'] }),
    { jsDocs: value.docs })
})

test('DOM matches both file and exact line range, with state/store aliases', () => {
  const { audit } = setup()
  assert.deepEqual(audit.get({ ...query, valueKeys: ['events', 'services', 'state', 'store', 'unknown'] }), {
    events: [event], services: value.services, state, store: state,
  })
  assert.deepEqual(audit.get({ ...query, loc, valueKeys: ['events'] }), { events: [event] })
  for (const invalid of ['{', 'null', '{}', undefined]) {
    assert.deepEqual(audit.get({ ...query, loc: invalid, valueKeys: ['events'] }), { events: [] })
  }
})

test('selector-only bindings match elements found by parsed data-loc', () => {
  const { audit } = setup()
  const binding = { title: 'onClick', refSelector: '.widget' }
  audit.set({ tsx: query.tsx, value: { ...value, events: [binding] } })
  const previous = globalThis.document
  globalThis.document = { querySelector: () => ({ shadowRoot: { querySelectorAll: () => [
    { getAttribute: () => '{' },
    { getAttribute: () => JSON.stringify(loc), matches: selector => selector === '.widget' },
    { getAttribute: () => JSON.stringify({ ...loc, files: { jsx: 'Other.tsx' } }), matches: () => true },
  ] } }) }
  try {
    assert.deepEqual(audit.get({ ...query, valueKeys: ['events'] }), { events: [binding] })
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})

test('DOM jsDocs reads legacy docs for the nearest component only', () => {
  const { audit } = setup()
  const parentDoc = { title: 'Parent', refSelector: '.parent' }
  audit.set({ tsx: query.tsx, value: { ...value, docs: [parentDoc, ...value.docs] } })
  const previous = globalThis.document
  let component = { matches: selector => selector === '.widget' }
  globalThis.document = { querySelector: () => ({ shadowRoot: { querySelectorAll: () => [
    {
      getAttribute: () => JSON.stringify(loc),
      closest: selector => {
        assert.equal(selector, '[data-widget-name]:not([data-wrap-container])')
        return component
      },
    },
  ] } }) }
  try {
    assert.deepEqual(audit.get({ ...query, valueKeys: ['jsDocs'] }), { jsDocs: value.docs })
    component = { matches: () => false }
    assert.deepEqual(audit.get({ ...query, valueKeys: ['jsDocs'] }), { jsDocs: [] })
    component = null
    assert.deepEqual(audit.get({ ...query, valueKeys: ['jsDocs'] }), { jsDocs: [] })
    assert.deepEqual(audit.get({ ...query, loc: '{', valueKeys: ['jsDocs'] }), { jsDocs: [] })
    audit.set({ tsx: query.tsx, value: { ...value, docs: [{ refSelector: '[' }] } })
    component = { matches: () => { throw new SyntaxError('Invalid selector') } }
    assert.deepEqual(audit.get({ ...query, valueKeys: ['jsDocs'] }), { jsDocs: [] })
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})

test('aiDoc reads the same escaped key as @getDoc and migrates legacy strings', () => {
  const { audit, data } = setup()
  const key = `[data-loc*='${escapeCssAttributeValue(loc.files.jsx)}']`
    + `[data-loc*='${escapeCssAttributeValue('"codeLine":{"start":10,"end":12}')}']:not([data-wrap-container])`
  data._docs = { [key]: '# Analysis' }
  const { aiDoc } = audit.get({ ...query, valueKeys: ['aiDoc'] })
  assert.equal(aiDoc.content, '# Analysis')
  assert.equal(typeof aiDoc.createTime, 'number')
  assert.equal(data._docs[key], aiDoc)
  assert.equal(audit.get({ ...query, valueKeys: ['aiDoc'] }).aiDoc, aiDoc)
  // AI documents remain available even before graph data has been registered.
  assert.equal(audit.get({ ...query, tsx: 'missing', valueKeys: ['aiDoc'] }).aiDoc, aiDoc)
  assert.deepEqual(audit.get({ tsx: query.tsx, type: 'canvas', valueKeys: ['aiDoc'] }), {})
})

test('missing AI documents return the @getDoc empty document shape', () => {
  const { audit } = setup()
  for (const input of [query, { ...query, loc: '{' }]) {
    const { aiDoc } = audit.get({ ...input, valueKeys: ['aiDoc'] })
    assert.equal(aiDoc.content, '')
    assert.equal(typeof aiDoc.createTime, 'number')
  }
})
