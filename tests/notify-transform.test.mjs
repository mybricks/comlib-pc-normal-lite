import test from 'node:test'
import assert from 'node:assert/strict'
import { transformMain, transformLocal } from './helpers/notify-transform.mjs'

const item = { name: 'Form', title: '表单', summary: '提交表单', type: 'component' }

test('runtime adapters preserve component scope, root, relations and docs behavior', () => {
  const data = { Form: {
    ...item,
    fileName: 'Form.tsx',
    datasource: [{ bind: { selector: 'root' }, api: 'load' }],
    events: [{ bind: { selector: '.submit' }, name: 'onClick', relations: { Dialog: { type: 'open' } } }],
    state: [{ bind: { selector: '#field' }, field: 'value' }],
  }, App: { ...item, type: 'app' }, Application: { ...item, type: 'application' } }
  const main = transformMain(data, 'Page.tsx')
  const local = transformLocal(data, 'Page.tsx')
  assert.equal(main.services[0].refSelector,
    '[data-zone-filename="Form.tsx"][data-widget-name="Form"]:not([data-wrap-container]), [data-zone-filename="Form.tsx"] [data-widget-name="Form"]:not([data-wrap-container])')
  assert.equal(local.services[0].refSelector, 'body')
  assert.match(main.events[0].refSelector, /data-widget-name="Form"/)
  assert.match(main.events[0].refSelector, /data-zone-classnames\*="submit"/)
  assert.equal(local.events[0].refSelector,
    '[data-loc*="Form.tsx"][class*="submit"]:not([data-wrap-container]), [data-loc*="Form.tsx"] [class*="submit"]:not([data-wrap-container])')
  assert.deepEqual(main.events[0].relations, [{ type: 'open', refSelector: '[data-widget-name="Dialog"]:not([data-wrap-container])' }])
  assert.equal('relations' in local.events[0], false)
  assert.equal(main.docs.length, 1)
  assert.equal(main.docs[0].summary, item.summary)
  assert.deepEqual(local.docs, [{
    ...item,
    refSelector: '[data-loc*="Form.tsx"]:not([data-wrap-container])',
  }])
  for (const result of [main, local]) {
    assert.equal(result.state, result.store)
    assert.match(result.state[0].refSelector, /#field/)
    assert.equal(result.services[0].refType, 'component')
  }
})

test('local docs preserve all node metadata and use each node file or the page fallback', () => {
  const nodes = {
    Page: { name: 'Page', title: '页面', summary: '页面说明', type: 'page' },
    Form: { ...item, fileName: 'src/"Form"\\index.tsx' },
    Popup: { name: 'Popup', title: '弹窗', summary: '弹窗说明', type: 'popup', fileName: 'Popup.tsx' },
  }
  const local = transformLocal(nodes, 'Page.tsx')
  const main = transformMain(nodes, 'Page.tsx')
  assert.deepEqual(local.docs.map(({ refSelector, ...doc }) => doc),
    main.docs.map(({ refSelector, ...doc }) => doc))
  assert.deepEqual(local.docs.map(doc => doc.refSelector), [
    '[data-loc*="Page.tsx"]:not([data-wrap-container])',
    '[data-loc*="src/\\"Form\\"\\\\index.tsx"]:not([data-wrap-container])',
    '[data-loc*="Popup.tsx"]:not([data-wrap-container])',
  ])
})

test('both adapters prefer loc over selector, including file overrides and escaping', () => {
  const loc = { tag: 'button', startLine: 10, endLine: 12 }
  const data = { Form: {
    ...item, fileName: "src/it's\\Form.tsx",
    events: [{ bind: { selector: '.ignored', loc }, name: 'click' }],
    datasource: [{ bind: { loc }, api: 'save' }],
    state: [{ bind: { loc }, field: 'loading' }],
  } }
  const main = transformMain(data, 'fallback.tsx')
  const local = transformLocal(data, 'fallback.tsx')
  for (const key of ['events', 'services', 'state']) {
    assert.deepEqual(main[key], local[key])
    const { refSelector, location } = main[key][0]
    assert.deepEqual(location, { fileName: data.Form.fileName, ...loc })
    assert.match(refSelector, /data-parent-loc/)
    assert.ok(refSelector.includes("src/it\\'s\\\\Form.tsx"))
    assert.ok(refSelector.includes('"codeLine":{"start":10,"end":12}'))
    assert.equal(refSelector.includes('ignored'), false)
  }
})

test('legacy object and array formats produce equivalent output in both runtimes', () => {
  const legacy = { Form: { ...item,
    datasource: { root: { load: { desc: '加载' } } },
    state: { field: { value: { desc: '值' } } },
    events: { '.submit': { click: [{ title: '提交' }, { title: '校验' }] } },
  } }
  const current = { Form: { ...item,
    datasource: [{ bind: { selector: 'root' }, api: 'load', desc: '加载' }],
    state: [{ bind: { selector: 'field' }, field: 'value', desc: '值' }],
    events: ['提交', '校验'].map(title => ({ bind: { selector: '.submit' }, name: 'click', title })),
  } }
  for (const transform of [transformMain, transformLocal]) {
    assert.deepEqual(transform(legacy, 'Page.tsx'), transform(current, 'Page.tsx'))
    assert.deepEqual(transform({}, 'Page.tsx'), { events: [], services: [], state: [], store: [], docs: [] })
  }
})
