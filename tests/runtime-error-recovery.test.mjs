import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'

const base = '../src/utils/ai-code/render/next-runtime/'
const read = path => readFile(new URL(base + path, import.meta.url), 'utf8')
const eventsSource = stripTypeScriptTypes(await read('utils/events.ts'))
const missingSource = stripTypeScriptTypes(await read('utils/tempFilesMap.ts'))
const fsSource = stripTypeScriptTypes(await read('utils/fileSystem/index.ts'))
// Keep the real Render hooks and validation; replace only its JSX output so this
// regression test can run without a browser or a JSX compiler.
const renderSource = stripTypeScriptTypes((await read('runtime/render.tsx'))
  .replace(/import[\s\S]*?from ['"][^'"]+['"]/g, '')
  .replace(/  if \(error\) \{[\s\S]*$/, '  return { error, Entry }\n})\nRender'))

const file = (filename, compiled) => ({ filename, source: '', compiled: encodeURIComponent(compiled) })
const card = path => file('components/ReservationCard/index.tsx',
  `const css = require('${path}').default; exports.default = () => css.card`)
const style = filename => file(filename, JSON.stringify({ imports: [], classMap: { card: 'card' }, cssContent: '' }))

function mount({ strange = false, files = [] } = {}) {
  const slots = []
  let cursor = 0
  let pending = []
  let dirty = true
  let fs
  let output
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const context = {
    console,
    window: { __IS_AICODE__: strange, addEventListener() {}, removeEventListener() {} },
    FileWatcher: class { emit() {} },
    getCompiledCssContent: module => module.cssContent,
    hackProxy: () => ({}),
    createHotComponent: ({ entry }) => () => entry.currentImpl(),
    DYNAMIC_MODULE: Symbol('dynamic'),
    useRef(value) {
      const index = cursor++
      return slots[index] ??= { current: value }
    },
    useState(value) {
      const index = cursor++
      if (!(index in slots)) slots[index] = value
      return [slots[index], next => {
        next = typeof next === 'function' ? next(slots[index]) : next
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true }
      }]
    },
    useLayoutEffect(effect, deps) {
      const index = cursor++
      if (!sameDeps(slots[index], deps)) { slots[index] = deps; pending.push(effect) }
    },
    useMemo(factory, deps) {
      const index = cursor++
      if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() }
      return slots[index].value
    },
  }
  const Render = runInNewContext([
    eventsSource.replace('export { Events };', ''),
    missingSource.replace('export function ', 'function '),
    fsSource.replace(/^import .* from .*$/gm, '').replace(/^export const /gm, 'const ').replace('export { FileSystem }', ''),
    renderSource,
  ].join('\n'), context)
  const props = {
    entryFile: 'App.tsx', vibing: false, dependencies: { mybricks: {} },
    css: new Map(), definitions: {}, onRuntimeError() {}, onFileChange() {},
    onMount({ fileSystem }) {
      fs = fileSystem
      fs.init([
        style('components/ReservationCard/index.less'), ...files,
        card('../index.less'),
        file('App.tsx', "exports.default = require('./components/ReservationCard/index.tsx').default"),
      ])
    },
  }
  function flush() {
    for (let count = 0; dirty; count++) {
      assert.ok(count < 20, 'hooks should settle')
      dirty = false
      cursor = 0
      output = Render(props)
      const effects = pending
      pending = []
      effects.forEach(effect => effect())
    }
    return output
  }
  flush()
  return { fs, flush, get output() { return output } }
}

for (const strange of [false, true]) {
  test(`fixing a child import restores rendering (special environment: ${strange})`, () => {
    const runtime = mount({ strange })
    assert.match(runtime.output.error.message, /components\/index.less/)
    runtime.fs.update('components/ReservationCard/index.tsx', card('./index.less'))
    const output = runtime.flush()
    assert.equal(Object.keys(runtime.fs.tempFilesMap).length, 0)
    assert.equal(output.error, null)
    assert.equal(output.Entry(), 'card')
  })
}

test('an unresolved replacement path updates the error instead of dismissing it', () => {
  const runtime = mount()
  runtime.fs.update('components/ReservationCard/index.tsx', card('./missing.less'))
  const { error } = runtime.flush()
  assert.match(error.message, /ReservationCard\/missing.less/)
  assert.doesNotMatch(error.message, /`components\/index.less`/)
})

test('creating the missing file also restores rendering', () => {
  const runtime = mount()
  runtime.fs.update('components/index.less', style('components/index.less'))
  assert.equal(runtime.flush().error, null)
})

test('fixing one importer retains errors from another importer', () => {
  const runtime = mount({ files: [file('other.ts', "exports.default = require('./missing.ts')")] })
  runtime.fs.update('components/ReservationCard/index.tsx', card('./index.less'))
  assert.match(runtime.flush().error.message, /missing.ts/)
})
