import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const source = async path => stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'))
const modeUrl = moduleUrl(await source('../src/platforms/local-iframe/context/launch-mode.ts'))
const eventsUrl = moduleUrl(await source('../src/utils/events.ts'))
const runtimeUrl = moduleUrl((await source('../src/platforms/local-iframe/context/runtime.ts'))
  .replace("'./launch-mode'", JSON.stringify(modeUrl))
  .replace("'../../../utils/events'", JSON.stringify(eventsUrl)))
const { isCliLaunch } = await import(modeUrl)
const { Runtime } = await import(runtimeUrl)

function withWindow(value, run) {
  const previous = globalThis.window
  globalThis.window = value
  try { return run() } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

test('CLI ignores read-only preview runtime and never requests desktop processes', async () => {
  const messages = []
  const listeners = []
  const page = {
    __LINGCHUANG_CONFIG__: { launchMode: 'cli' },
    __APP__: { projectRuntime: { getSnapshot: () => ({ status: { state: 'ready', url: 'http://localhost:5173/' } }) } },
    addEventListener: (...args) => listeners.push(args),
    parent: { postMessage: (...args) => messages.push(args) },
  }
  let operations
  withWindow(page, () => {
    assert.equal(isCliLaunch(), true)
    const runtime = new Runtime()
    operations = [runtime.start(), runtime.stop(), runtime.restart()]
    assert.equal(listeners.length, 0)
    assert.equal(messages.length, 0)
  })
  for (const operation of operations) await assert.rejects(operation)
})

test('desktop keeps direct startup, process controls and ready URL updates', () => {
  const calls = []
  let receive
  const status = { projectId: 'project', state: 'ready', message: 'ready', url: 'http://localhost:5173/' }
  const page = {
    __LINGCHUANG_CONFIG__: { launchMode: 'desktop' },
    __APP__: {
      projectRuntime: {
        start: () => { calls.push('start'); return Promise.resolve(status) },
        stop: () => Promise.resolve(status), restart: () => Promise.resolve(status),
        getSnapshot: () => ({ status }),
      },
      projectRuntimeEvents: { on: (_type, handler) => { receive = handler; return () => {} } },
    },
    addEventListener() {},
  }
  page.parent = page
  withWindow(page, () => {
    const runtime = new Runtime()
    assert.deepEqual(calls, ['start'])
    assert.equal(runtime.getSnapshot().supportsControls, true)
    const urls = []
    runtime.events.on('runtimeUrl', event => urls.push(event.url))
    assert.deepEqual(urls, ['http://localhost:5173/'])
    receive({ status: { ...status, url: 'http://localhost:5174/' } })
    assert.equal(urls.at(-1), 'http://localhost:5174/')
  })
})

test('older desktop hosts without launchMode retain the parent bridge protocol', () => {
  const messages = []
  let receive
  const parent = { postMessage: (message, origin) => messages.push({ message, origin }) }
  const page = { parent, location: { origin: 'lingxi-playground://app' }, addEventListener: (_type, handler) => { receive = handler } }
  withWindow(page, () => {
    assert.equal(isCliLaunch(), false)
    new Runtime()
    assert.deepEqual(messages.map(({ message }) => message.type), ['subscribe', 'start'])
    assert.ok(messages.every(({ origin }) => origin === 'lingxi-playground://app'))
    receive({ source: parent, origin: 'lingxi-playground://app', data: {
      channel: 'lingxi:project-runtime', type: 'start-result', requestId: messages[1].message.requestId,
      status: { projectId: 'project', state: 'ready', message: 'ready', url: 'http://localhost:5173/' },
    } })
  })
})
