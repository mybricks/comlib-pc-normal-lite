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
  docs: [{ title: 'Page', refSelector: '[data-widget-name="Page"]:not([data-wrap-container])' }],
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
    { events: value.events, store: state, jsDocs: value.docs })
  assert.deepEqual(audit.get({ tsx: 'missing', type: 'canvas', valueKeys: ['events'] }), { events: [], jsDocs: [] })
  assert.deepEqual(audit.get({ tsx: query.tsx, type: 'canvas', valueKeys: ['jsDocs'] }),
    { jsDocs: value.docs })
})

test('DOM matches both file and exact line range, with state/store aliases', () => {
  const { audit } = setup()
  assert.deepEqual(audit.get({ ...query, valueKeys: ['events', 'services', 'state', 'store', 'unknown'] }), {
    events: [event], services: value.services, state, store: state, jsDocs: [],
  })
  assert.deepEqual(audit.get({ ...query, loc, valueKeys: ['events'] }), { events: [event], jsDocs: [] })
  for (const invalid of ['{', 'null', '{}', undefined]) {
    assert.deepEqual(audit.get({ ...query, loc: invalid, valueKeys: ['events'] }), { events: [], jsDocs: [] })
  }
})

test('DOM matches either loc or parentLoc and ignores missing or invalid parentLoc', () => {
  const { audit } = setup()
  const parentLoc = { files: { jsx: 'Parent.tsx' }, codeLine: { start: 20, end: 24 } }
  const parentLocation = { fileName: 'Parent.tsx', startLine: 20, endLine: 24 }
  const parentEvent = { title: 'parent click', location: parentLocation }
  audit.set({ tsx: query.tsx, value: { ...value, events: [
    event, parentEvent,
    { location: { ...parentLocation, endLine: 25 } },
    { location: { ...parentLocation, fileName: 'Other.tsx' } },
  ] } })
  for (const input of [parentLoc, JSON.stringify(parentLoc)]) {
    assert.deepEqual(audit.get({ ...query, parentLoc: input, valueKeys: ['events'] }),
      { events: [event, parentEvent], jsDocs: [] })
    assert.deepEqual(audit.get({ ...query, loc: undefined, parentLoc: input, valueKeys: ['events'] }),
      { events: [parentEvent], jsDocs: [] })
  }
  for (const input of [undefined, null, '', '{', 'null', '{}']) {
    assert.deepEqual(audit.get({ ...query, parentLoc: input, valueKeys: ['events'] }),
      { events: [event], jsDocs: [] })
  }
})

test('DOM jsDocs matches widgetName without DOM lookup or location', () => {
  const { audit } = setup()
  const parentDoc = { title: 'Parent', refSelector: '[data-widget-name="Parent"]' }
  const similarlyNamedDoc = { title: 'PageExtra', refSelector: '[data-widget-name="PageExtra"]' }
  audit.set({ tsx: query.tsx, value: { ...value, docs: [parentDoc, similarlyNamedDoc, ...value.docs] } })
  assert.deepEqual(audit.get({ ...query, widgetName: 'Page', valueKeys: [] }), { jsDocs: value.docs })
  assert.deepEqual(audit.get({ ...query, loc: undefined, widgetName: 'Page', valueKeys: ['jsDocs'] }),
    { jsDocs: value.docs })
  for (const widgetName of [undefined, null, '', 'Missing']) {
    assert.deepEqual(audit.get({ ...query, widgetName, valueKeys: ['jsDocs'] }), { jsDocs: [] })
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
  assert.deepEqual(audit.get({ tsx: query.tsx, type: 'canvas', valueKeys: ['aiDoc'] }), { jsDocs: value.docs })
})

test('missing AI documents return the @getDoc empty document shape', () => {
  const { audit } = setup()
  for (const input of [query, { ...query, loc: '{' }]) {
    const { aiDoc } = audit.get({ ...input, valueKeys: ['aiDoc'] })
    assert.equal(aiDoc.content, '')
    assert.equal(typeof aiDoc.createTime, 'number')
  }
})
