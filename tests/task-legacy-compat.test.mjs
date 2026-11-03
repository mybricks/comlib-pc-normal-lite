import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'

// The package has no test compiler; load its TypeScript source directly in Node.
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const notifySource = await readFile(new URL('../src/mix/tasks/notify.ts', import.meta.url), 'utf8')
const notifyUrl = moduleUrl(stripTypeScriptTypes(notifySource))
const transitionSource = await readFile(new URL('../src/mix/tasks/transition.ts', import.meta.url), 'utf8')
const transitionUrl = moduleUrl(stripTypeScriptTypes(transitionSource).replace("'./notify'", JSON.stringify(notifyUrl)))
const { parseTasksForNotify, resolveTaskId } = await import(notifyUrl)
const { applyTaskTransition, readTaskStatus } = await import(transitionUrl)

const legacyTask = `## BadCase 核查卡片归因操作内联

- **更新时间**：2026-11-03 14:24
- **状态**：待验证
- **交接给**：服务端
- **交接原因**：接口需要补充 taskId 字段。

> 在 BadCase 核查卡片中内联提交归因操作。
`

test('无编号待验证任务可验证通过并交接，其他内容保持不变', () => {
  const content = `# 任务列表\n\n${legacyTask}\n## T-001 其他任务\n- **状态**：处理中\n`
  const task = parseTasksForNotify(content)[0]
  assert.equal(task.verification, undefined)
  assert.equal(task.handoverTo, '服务端')
  const updated = applyTaskTransition(content, task.id, '待交接', { from: '待验证' })
  assert.equal(readTaskStatus(updated, task.id), '待交接')
  assert.match(updated, /\*\*交接原因\*\*：接口需要补充 taskId 字段。/)
  assert.match(updated, /## T-001 其他任务\n- \*\*状态\*\*：处理中/)
})

test('无编号任务可以提交修改，状态变化后不会被旧操作覆盖', () => {
  const task = parseTasksForNotify(legacyTask)[0]
  const updated = applyTaskTransition(legacyTask, task.id, '待处理', { from: '待验证' })
  assert.equal(readTaskStatus(updated, task.id), '待处理')
  assert.equal(applyTaskTransition(updated, task.id, '待交接', { from: '待验证' }), updated)
})

test('无编号任务没有交接对象时可以标记完成，编号任务仍可正常更新', () => {
  const content = '## 修复按钮\n- **状态**：待验证\n\n## T-001 其他任务\n- **状态**：待验证\n'
  const [legacy, numbered] = parseTasksForNotify(content)
  assert.equal(legacy.handoverTo, undefined)
  const completed = applyTaskTransition(content, legacy.id, '已完成', { from: '待验证', expectedTitle: legacy.title })
  assert.equal(readTaskStatus(completed, legacy.id), '已完成')
  const updated = applyTaskTransition(completed, numbered.id, '待处理', { from: '待验证' })
  assert.equal(readTaskStatus(updated, numbered.id), '待处理')
})

test('多个无编号任务的标识不冲突，更新时只修改目标任务', () => {
  const content = `# 任务列表\n\n## BadCase 第一个任务\n- **状态**：待验证\n\n## BadCase 第二个任务\n- **状态**：待验证\n\n## 纯中文任务\n- **状态**：待验证\n`
  const tasks = parseTasksForNotify(content)
  assert.equal(new Set(tasks.map((task) => task.id)).size, 3)
  const updated = applyTaskTransition(content, tasks[1].id, '待处理', { from: '待验证' })
  assert.equal(readTaskStatus(updated, tasks[0].id), '待验证')
  assert.equal(readTaskStatus(updated, tasks[1].id), '待处理')
  assert.equal(readTaskStatus(updated, tasks[2].id), '待验证')
})

test('中文任务插入或排序后仍使用同一标识，并更新正确任务', () => {
  const original = '## 第一个任务\n- **状态**：待验证\n'
  const task = parseTasksForNotify(original)[0]
  const changed = `## 新插入的任务\n- **状态**：待验证\n\n${original}`
  const tasks = parseTasksForNotify(changed)
  assert.equal(tasks[1].id, task.id)
  assert.notEqual(tasks[0].id, task.id)
  const updated = applyTaskTransition(changed, task.id, '待处理', { from: '待验证', expectedTitle: task.title })
  assert.equal(readTaskStatus(updated, tasks[0].id), '待验证')
  assert.equal(readTaskStatus(updated, task.id), '待处理')
  assert.equal(applyTaskTransition(changed, task.id, '待处理', { from: '待验证', expectedTitle: '其他任务' }), changed)
})

test('同标题任务仍有不同标识，并能解析已有旧引用', () => {
  const content = `${legacyTask}\n## 完全中文\n- **状态**：待验证\n\n## 完全中文\n- **状态**：待验证\n`
  const tasks = parseTasksForNotify(content)
  assert.match(tasks[0].id, /^legacy-/)
  assert.notEqual(tasks[1].id, tasks[2].id)
  assert.equal(resolveTaskId(content, 'badcase-'), tasks[0].id)
  assert.equal(resolveTaskId(content, '1'), tasks[1].id)
  assert.equal(resolveTaskId(content, tasks[2].id), tasks[2].id)
  assert.equal(resolveTaskId(content, 'missing-task'), undefined)
})
