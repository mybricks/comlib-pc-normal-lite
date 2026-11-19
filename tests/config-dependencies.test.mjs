import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const withoutImports = source => stripTypeScriptTypes(source).replace(/^import .*$/gm, '')
const configSource = withoutImports(await read('../src/mix/context/config.ts'))
  .replace('export const DYNAMIC_MODULE', 'const DYNAMIC_MODULE')
  .replace('export default new Config()', 'new Config()')
const librariesSource = withoutImports(await read('../src/mix/availableLibraries/index.ts'))
  .replace(/^export /gm, '')

function setup(componentRuntime, availableLibraries = []) {
  const library = name => ({ name, usage: '', version: '' })
  const config = runInNewContext(configSource, {
    window: { _sandbox_: { config: { componentRuntime, availableLibraries } } },
    antd: {}, dayjs: {}, echartsForReact: {}, zhCN: {},
  })
  const getLibraryDocs = runInNewContext(librariesSource + '\ngetEffectiveLibraries', {
    config,
    mybricks: { ...library('mybricks'), usage: () => '' },
    antd: library('antd'), dayjs: library('dayjs'),
    echarts: library('echarts-for-react'), antDesignIcons: library('@ant-design/icons'),
  })
  return { config, docNames: () => Array.from(getLibraryDocs(), lib => lib.name) }
}

const frontendFile = { fileName: 'src/index.tsx' }
for (const [label, result] of [['undefined', undefined], ['null', null], ['empty object', {}]]) {
  for (const scope of ['root', 'module']) {
    test(`${scope} getDependencies returning ${label} disables presets and keeps React validation`, () => {
      const getDependencies = () => result
      const runtime = scope === 'root'
        ? { getDependencies }
        : { modules: { 'src/': { type: 'frontend', getDependencies } } }
      const { config, docNames } = setup(runtime)
      assert.deepEqual(Object.keys(config.getAllDependencies()), [])
      assert.deepEqual(Array.from(config.getAddonLibraryNames(frontendFile)), ['react', 'react-dom'])
      assert.deepEqual(Array.from(config.getAddonValidators(frontendFile)), [])
      assert.deepEqual(Array.from(config.getEffectiveLibraries()), [])
      assert.deepEqual(docNames(), ['mybricks'])
    })
  }
}

test('unconfigured dependencies retain presets', () => {
  const { config, docNames } = setup({})
  assert.deepEqual(Object.keys(config.getAllDependencies()), ['antd', 'dayjs', 'echarts-for-react', 'antd/locale/zh_CN'])
  assert.ok(config.getAddonLibraryNames(frontendFile).includes('antd'))
  assert.equal(config.getAddonValidators(frontendFile), null)
  assert.ok(docNames().includes('antd'))
})

test('module dependency configuration respects file prefixes and patterns', () => {
  const { config } = setup({ modules: {
    'server/': { type: 'backend', pattern: /\.server\.ts$/, getDependencies: () => undefined },
  } })
  assert.ok(config.getAddonLibraryNames(frontendFile).includes('antd'))
  for (const fileName of ['server/index.ts', 'src/app.server.ts']) {
    assert.deepEqual(Array.from(config.getAddonLibraryNames({ fileName })), ['react', 'react-dom'])
    assert.deepEqual(Array.from(config.getAddonValidators({ fileName })), [])
  }
})

test('configured dependencies retain modules, validators and documentation', () => {
  const module = {}
  const validator = {}
  const { config, docNames } = setup({ getDependencies: () => ({ custom: { module, validator } }) })
  assert.equal(config.getAllDependencies().custom, module)
  assert.deepEqual(Array.from(config.getAddonLibraryNames(frontendFile)), ['custom', 'react', 'react-dom'])
  assert.equal(config.getAddonValidators(frontendFile)[0], validator)
  assert.deepEqual(docNames(), ['mybricks', 'custom'])
})

test('empty dependency functions preserve explicitly configured compatible libraries', () => {
  const { config, docNames } = setup({ getDependencies: () => undefined }, [{ name: 'legacy', library: 'Legacy' }])
  assert.deepEqual(Object.keys(config.getAllDependencies()), ['legacy'])
  assert.deepEqual(Array.from(config.getAddonLibraryNames(frontendFile)), ['legacy', 'react', 'react-dom'])
  assert.deepEqual(docNames(), ['mybricks', 'legacy'])
})
