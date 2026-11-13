import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'

const source = stripTypeScriptTypes(await readFile(new URL(
  '../src/utils/ai-code/render/next-runtime/utils/fileSystem/index.ts', import.meta.url,
), 'utf8'))

// Exercise the real loader with browser/React services stubbed out.
const FileSystem = runInNewContext(source
  .replace(/^import .* from .*$/gm, '')
  .replace(/^export const /gm, 'const ')
  .replace('export { FileSystem }', 'FileSystem'), {
  console: { log() {} },
  Events: class { emit() {} },
  FileWatcher: class { emit() {} },
  getCompiledCssContent: module => module.cssContent,
  hackProxy: () => ({}),
  createHotComponent: () => () => null,
  DYNAMIC_MODULE: Symbol('dynamic'),
})

const less = (filename, imports = [], classMap = {}) => ({
  filename,
  source: '',
  compiled: encodeURIComponent(JSON.stringify({ imports, classMap, cssContent: `/* ${filename} */` })),
})

function runtime(files) {
  const css = new Map()
  const fs = new FileSystem({ dependencies: { mybricks: {} }, definitions: {}, css, entryFile: 'App.tsx' })
  fs.init(files)
  return { fs, order: [...css.keys()] }
}

test('child LESS imports root LESS even when supplied before it', () => {
  const child = 'pages/InventoryPage/index.module.less'
  const { fs, order } = runtime([
    less(child, ['../../index.module.less'], { local: 'child--local' }),
    less('index.module.less', [], { shared: 'root--shared' }),
  ])

  assert.deepEqual(order, ['index.module.less', child])
  assert.equal(fs.filesMap[child].module.default.shared, 'root--shared')
  assert.equal(fs.filesMap[child].module.default.local, 'child--local')
  assert.equal(Object.keys(fs.tempFilesMap).length, 0)
  assert.ok(fs.filesMap[child].dependencies.has('index.module.less'))
})

test('nested LESS dependencies and shared imports load before their importers', () => {
  const { fs, order } = runtime([
    less('pages/detail/index.module.less', ['../../index.module.less']),
    less('index.module.less', ['./styles/base.less']),
    less('pages/list/index.module.less', ['../../index.module.less']),
    less('styles/base.less'),
  ])

  assert.deepEqual(order, [
    'styles/base.less', 'index.module.less',
    'pages/detail/index.module.less', 'pages/list/index.module.less',
  ])
  assert.equal(Object.keys(fs.tempFilesMap).length, 0)
})

test('JS requires retain dependency ordering alongside LESS imports', () => {
  const { fs, order } = runtime([
    { filename: 'entry.js', compiled: encodeURIComponent('exports.default = require("./pages/index.module.less").default.shared') },
    less('pages/index.module.less', ['../index.module.less']),
    less('index.module.less', [], { shared: 'root--shared' }),
  ])

  assert.deepEqual(order, ['index.module.less', 'pages/index.module.less'])
  assert.equal(fs.filesMap['entry.js'].module.default, 'root--shared')
  assert.equal(Object.keys(fs.tempFilesMap).length, 0)
})
