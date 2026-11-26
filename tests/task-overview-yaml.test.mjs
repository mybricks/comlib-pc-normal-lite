import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import YAML from 'yaml'

const source = await readFile(new URL('../src/components/task-panel/overview-yaml.ts', import.meta.url), 'utf8')
const { parseOverviewYaml } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)

test('兼容描述中的冒号和空格，保留其他字段和注释', () => {
  const content = 'version: 4\nchanges:\n  - id: C-024\n    desc: 保留图片 object-fit: cover、播放按钮。 # 备注\n    tasks: [T-014]\n'
  assert.deepEqual(parseOverviewYaml(content, YAML.parse), {
    version: 4,
    changes: [{ id: 'C-024', desc: '保留图片 object-fit: cover、播放按钮。', tasks: ['T-014'] }],
  })
})

test('有效 YAML 保持原有解析语义', () => {
  const content = 'desc: "object-fit: cover"\nother: true\n'
  assert.deepEqual(parseOverviewYaml(content, YAML.parse), YAML.parse(content))
})

test('其他 YAML 格式错误仍然报错', () => {
  assert.throws(() => parseOverviewYaml('desc: object-fit: cover\nchanges: [\n', YAML.parse))
})
