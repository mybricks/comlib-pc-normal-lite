import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { transformLocal } from './helpers/notify-transform.mjs'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const source = async path => stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'))
const auditUrl = moduleUrl(await source('../src/platforms/local-iframe/context/audit.ts'))
const { Audit } = await import(auditUrl)
const fixtureUrl = moduleUrl(`
  import { Audit } from ${JSON.stringify(auditUrl)};
  export const context = { audit: new Audit() };
  export const fixture = {};
  export const refreshLocalGraph = () => fixture.refresh();
  export const getClosestDomLoc = ele => ele.loc;
  export const updateDoc = () => {};
  export const executeLocalShellCommand = () => {};
  export const readLocalFiles = () => {};
  export const agentTurnLifecycle = { register: (_id, complete) => { fixture.complete = complete } };
  export const auditPageI18n = {
    events: () => 'events', services: () => 'services', crScope: () => 'scope', store: () => 'store',
    pageMessage: path => path,
  };
  export default context;
`)
const { context, fixture } = await import(fixtureUrl)
const hookSource = await source('../src/platforms/local-iframe/editors/auditPage.ts')
const { default: auditPage } = await import(moduleUrl(hookSource
  .replace(/'\.\.\/[^']+'/g, JSON.stringify(fixtureUrl))))
const docSource = await source('../src/platforms/local-iframe/editors/doc.ts')
const { default: docEditors } = await import(moduleUrl(docSource
  .replace(/'\.\.\/[^']+'/g, JSON.stringify(fixtureUrl))))

const value = title => transformLocal({ Page: {
  name: 'Page', title: 'Page', summary: title, type: 'page', fileName: 'src/Page.tsx',
  events: [{ name: 'click', title, bind: { selector: '.submit' } }],
  state: [{ field: 'loading', desc: title, bind: { selector: 'root' } }],
} }, 'src/Page.tsx')

test('route cache replaces parsed values, isolates pages and clears removed routes', async () => {
  const audit = new Audit()
  const oldValue = value('old')
  const newValue = value('new')
  audit.set({ path: '/page', value: oldValue })
  audit.set({ path: '/other', value: oldValue })
  audit.set({ path: '/page', value: newValue })
  assert.deepEqual(await audit.get({ path: '/page', valueKeys: ['events', 'store', 'unknown'] }),
    { events: newValue.events, store: newValue.store })
  assert.deepEqual(await audit.get({ path: '/other', valueKeys: ['events'] }), { events: oldValue.events })
  assert.equal((await audit.get({ path: '/page', valueKeys: ['jsDoc'] })).jsDoc.summary, 'new')
  assert.equal((await audit.get({ path: '/other', valueKeys: ['jsDoc'] })).jsDoc.summary, 'old')
  audit.clear()
  assert.deepEqual(await audit.get({ path: '/page', valueKeys: ['events', 'jsDoc'] }),
    { events: [], jsDoc: undefined })
})

test('audit completion waits for graph refresh and returns the updated route data', async () => {
  const previousWindow = globalThis.window
  const calls = []
  globalThis.window = { _sandbox_: { helpers: { sendToAgent: () => calls.push('send') } } }
  context.audit.clear()
  context.audit.set({ path: '/page', value: value('old') })
  const updated = value('new')
  let finishRefresh
  fixture.refresh = () => new Promise(resolve => {
    finishRefresh = () => {
      context.audit.set({ path: '/page', value: updated })
      resolve()
    }
  })
  try {
    const result = auditPage({ id: 'test', focusArea: { ele: { dataset: { iframePath: '/page' } } } }, {
      onComplete: () => calls.push('complete'), onError: () => calls.push('error'),
    })
    const completion = fixture.complete({ status: 'success' })
    assert.deepEqual(calls, ['send'])
    finishRefresh()
    await completion
    assert.deepEqual(await result, { events: updated.events, services: [],
      state: updated.state, store: updated.store, jsDoc: updated.docs[0] })
    assert.deepEqual(calls, ['send', 'complete'])
  } finally {
    globalThis.window = previousWindow
  }
})

test('agent and graph refresh failures reject the audit and call onError', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { _sandbox_: { helpers: { sendToAgent() {} } } }
  try {
    for (const status of ['error', 'success']) {
      let errors = 0
      let refreshes = 0
      fixture.refresh = async () => { refreshes++; throw new Error('read failed') }
      const result = auditPage({ id: 'test', focusArea: { ele: { dataset: { iframePath: '/page' } } } }, {
        onComplete: () => assert.fail('must not complete'), onError: () => errors++,
      })
      const rejection = assert.rejects(result, status === 'error' ? /Page audit failed/ : /read failed/)
      await fixture.complete({ status })
      await rejection
      assert.equal(errors, 1)
      assert.equal(refreshes, status === 'success' ? 1 : 0)
    }
  } finally {
    globalThis.window = previousWindow
  }
})

test('DOM queries filter exact source locations and match docs by the node file', async () => {
  const audit = new Audit()
  const loc = { files: { jsx: '/project/Child.tsx' }, codeLine: { start: 10, end: 12 } }
  const parentLoc = { files: { jsx: '/project/Parent.tsx' }, codeLine: { start: 20, end: 24 } }
  const node = (fileName, startLine, endLine) => ({
    name: fileName, title: fileName, summary: fileName, type: 'component', fileName,
    events: [{ name: 'click', bind: { loc: { tag: 'button', startLine, endLine } } }],
    datasource: [{ api: 'save', bind: { loc: { tag: 'button', startLine, endLine } } }],
    state: [{ field: 'loading', bind: { loc: { tag: 'button', startLine, endLine } } }],
  })
  const value = transformLocal({
    Parent: node('Parent.tsx', 20, 24), Child: node('Child.tsx', 10, 12),
    OtherLine: node('Child.tsx', 10, 13), OtherFile: node('Other.tsx', 10, 12),
  }, 'Page.tsx')
  audit.set({ path: '/page', value })
  const query = { path: '/page', type: 'dom', loc, parentLoc: JSON.stringify(parentLoc),
    valueKeys: ['events', 'services', 'state', 'store', 'jsDoc'] }
  const result = await audit.get(query)
  for (const key of ['events', 'services', 'state', 'store']) {
    assert.deepEqual(result[key], value[key].slice(0, 2))
  }
  assert.equal(result.jsDoc, value.docs[1])
  assert.deepEqual(await audit.get({ ...query, loc: '{', parentLoc: null, valueKeys: ['events', 'jsDoc'] }),
    { events: [], jsDoc: undefined })
  assert.deepEqual(await audit.get({ ...query, loc: null, valueKeys: ['events'] }), { events: [value.events[0]] })
})

test('source suffix matching handles a leading slash and respects path segment boundaries', async () => {
  const jsx = '/Users/lianglihao/Documents/GitLab/aster/frontend/src/components/LoginPage.tsx'
  for (const fileName of ['frontend/src/components/LoginPage.tsx', '/frontend/src/components/LoginPage.tsx']) {
    const audit = new Audit()
    const value = transformLocal({ Login: {
      name: 'Login', title: 'Login', summary: 'Login', type: 'page', fileName,
      events: [{ name: 'click', bind: { loc: { tag: 'button', startLine: 10, endLine: 12 } } }],
    } }, fileName)
    audit.set({ path: '/login', value })
    const query = { path: '/login', type: 'dom', valueKeys: ['events', 'jsDoc'],
      loc: { files: { jsx }, codeLine: { start: 10, end: 12 } } }
    assert.deepEqual(await audit.get(query), { events: value.events, jsDoc: value.docs[0] })
    assert.deepEqual(await audit.get({ ...query, loc: {
      ...query.loc, files: { jsx: jsx.replace('/frontend/', '/other-frontend/') },
    } }), { events: [], jsDoc: undefined })
  }
})

test('aiDoc delegates to the existing doc store only for requested DOM queries', async () => {
  const loc = { files: { jsx: 'Child.tsx' }, codeLine: { start: 10, end: 12 } }
  const saved = { createTime: 123, content: 'Saved analysis' }
  const reads = []
  const audit = new Audit({
    buildKey(files, codeLine) {
      assert.deepEqual(files, loc.files)
      assert.deepEqual(codeLine, loc.codeLine)
      return 'existing-doc-key'
    },
    async get(key) { reads.push(key); return saved },
  })
  const query = { path: '/missing', type: 'dom', loc: JSON.stringify(loc) }
  assert.deepEqual(await audit.get({ ...query, valueKeys: ['events'] }), { events: [] })
  assert.deepEqual(await audit.get({ ...query, type: 'canvas', valueKeys: ['aiDoc'] }), {})
  assert.deepEqual(reads, [])
  assert.deepEqual(await audit.get({ ...query, valueKeys: ['aiDoc'] }), { aiDoc: saved })
  assert.deepEqual(reads, ['existing-doc-key'])
  const empty = await audit.get({ ...query, loc: '{', valueKeys: ['aiDoc'] })
  assert.equal(empty.aiDoc.content, '')
  assert.equal(typeof empty.aiDoc.createTime, 'number')
  assert.deepEqual(reads, ['existing-doc-key'])
})

test('@getDoc forwards canvas and iframe DOM queries to audit.get', async () => {
  const previousAudit = context.audit
  const queries = []
  const result = { events: [], aiDoc: { createTime: 1, content: 'analysis' } }
  context.audit = { async get(query) { queries.push(query); return result } }
  const page = { getAttribute: name => ({ 'data-zone-type': 'page', 'data-iframe-path': '/page' })[name] ?? null }
  const loc = { files: { jsx: 'Child.tsx' }, codeLine: { start: 10, end: 12 } }
  const dom = {
    loc,
    getAttribute: name => name === 'data-parent-loc' ? JSON.stringify(loc) : null,
    ownerDocument: { defaultView: { frameElement: {
      closest(selector) { assert.equal(selector, '[data-iframe-path]'); return page },
    } } },
  }
  try {
    const getDoc = docEditors()['@getDoc']
    assert.equal(await getDoc({ focusArea: { ele: page } }, ['events', 'jsDoc']), result)
    assert.equal(await getDoc({ focusArea: { ele: dom } }, ['aiDoc']), result)
    assert.deepEqual(queries, [
      { path: '/page', type: 'canvas', loc: undefined, parentLoc: undefined, valueKeys: ['events', 'jsDoc'] },
      { path: '/page', type: 'dom', loc, parentLoc: JSON.stringify(loc), valueKeys: ['aiDoc'] },
    ])
  } finally {
    context.audit = previousAudit
  }
})
