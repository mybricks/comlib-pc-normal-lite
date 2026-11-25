import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'

const source = await readFile(new URL('../src/mix/understand-any/diagram/layout.ts', import.meta.url), 'utf8')
const js = stripTypeScriptTypes(source).replace('"dagre"', JSON.stringify(import.meta.resolve('dagre')))
const { createFlowLayout, edgeLabelSize } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const parserSource = await readFile(new URL('../src/mix/understand-any/diagram/parse.ts', import.meta.url), 'utf8')
const { parseDiagram } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(parserSource)).toString('base64')}`)

const intersect = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

test('mindmap layout preserves UI bindings in both directions', () => {
  const diagram = parseDiagram('```mermaid\nmindmap\n  root((订单接口))\n    TOTAL[订单金额]\n      PRICE[金额文本]\n  %% @source root value="GET /orders"\n  %% @field TOTAL name="total"\n  %% @ui PRICE file="src/OrderCard.tsx" loc="span:42"\n```')
  for (const direction of ['LR', 'TB']) {
    const layout = createFlowLayout({ ...diagram, direction })
    assert.deepEqual(layout.nodes.find(node => node.id === 'PRICE').ui, [{ file: 'src/OrderCard.tsx', tag: 'span', startLine: 42, endLine: 42 }])
    assert.equal(layout.nodes.find(node => node.id === 'root').source.value, 'GET /orders')
    assert.equal(layout.nodes.find(node => node.id === 'TOTAL').field.name, 'total')
  }
})

for (const direction of ['TB', 'LR']) {
  test(`branch labels avoid other labels and nodes in ${direction} diagrams`, () => {
    const nodes = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => ({ id, label: id, shape: id === 'A' ? 'decision' : 'default' }))
    const edges = nodes.slice(1).map((node, index) => ({ source: 'A', target: node.id, label: `分支情况 ${index + 1} 的说明` }))
    const layout = createFlowLayout({ kind: 'flowchart', direction, nodes, edges })
    assert.ok(layout.edges.every(edge => edge.junction))
    assert.deepEqual(new Set(layout.edges.map(edge => JSON.stringify(edge.junction))).size, 1)
    assert.deepEqual(new Set(layout.edges.map(edge => JSON.stringify(edge.points[0]))).size, 1)
    const boxes = layout.edges.map(edge => {
      assert.ok(edge.labelPosition)
      const size = edgeLabelSize(edge.label)
      return { x: edge.labelPosition.x - size.width / 2, y: edge.labelPosition.y - size.height / 2, ...size }
    })
    for (const [index, box] of boxes.entries()) {
      for (const other of boxes.slice(index + 1)) assert.equal(intersect(box, other), false)
      for (const node of layout.nodes) assert.equal(intersect(box, { ...node.position, width: node.width, height: node.height }), false)
    }
  })
}

test('workbench branches share a junction and labels stay clear', () => {
  const ids = ['HOME', 'OVERVIEW', 'WELCOME', 'SUMMARY', 'TREND', 'RECENT', 'TODO', 'NOTICE', 'LOADING', 'LOGIN', 'SERVICE', 'USER', 'GREETING', 'MESSAGE']
  const links = [
    ['HOME', 'OVERVIEW', '页面加载'], ['OVERVIEW', 'WELCOME', '返回店铺信息'],
    ['OVERVIEW', 'SUMMARY', '返回经营指标'], ['OVERVIEW', 'TREND', '返回近七日订单数据'],
    ['OVERVIEW', 'RECENT', '返回近期订单数据'], ['OVERVIEW', 'TODO', '返回待处理事项'],
    ['OVERVIEW', 'NOTICE', '返回平台公告'], ['HOME', 'LOADING', '数据准备期间显示'],
    ['LOGIN', 'SERVICE', '提交账号和密码'], ['SERVICE', 'USER', '成功：返回用户名'],
    ['USER', 'GREETING', '显示为'], ['SERVICE', 'MESSAGE', '失败：返回提示'],
  ]
  const layout = createFlowLayout({ kind: 'flowchart', direction: 'LR',
    nodes: ids.map(id => ({ id, label: id, shape: 'default' })),
    edges: links.map(([source, target, label]) => ({ source, target, label })) })
  const branches = layout.edges.filter(edge => edge.source === 'OVERVIEW')
  assert.equal(branches.length, 6)
  assert.ok(branches.every(edge => edge.junction))
  assert.equal(new Set(branches.map(edge => JSON.stringify(edge.junction))).size, 1)
  const boxes = layout.edges.map(edge => {
    const size = edgeLabelSize(edge.label)
    return { x: edge.labelPosition.x - size.width / 2, y: edge.labelPosition.y - size.height / 2, ...size }
  })
  for (const [index, box] of boxes.entries()) {
    for (const other of boxes.slice(index + 1)) assert.equal(intersect(box, other), false)
    for (const node of layout.nodes) assert.equal(intersect(box, { ...node.position, width: node.width, height: node.height }), false)
  }
})

test('long node titles grow within a fixed width for both diagram types', () => {
  const short = { id: 'short', label: '订单金额', shape: 'default' }
  const long = { id: 'long', label: '这是一个很长的节点标题需要换行显示但不改变字号', shape: 'default', field: { name: 'total' } }
  const decision = { id: 'decision', label: '这是一个需要换行才能说明清楚的较长判断条件', shape: 'decision' }
  for (const kind of ['mindmap', 'flowchart']) {
    const layout = createFlowLayout({ kind, direction: 'TB', nodes: [short, long, decision], edges: [
      { source: 'short', target: 'long' }, { source: 'long', target: 'decision' },
    ] })
    const nodes = Object.fromEntries(layout.nodes.map(node => [node.id, node]))
    assert.equal(nodes.short.width, nodes.long.width)
    assert.ok(nodes.long.height > nodes.short.height)
    assert.ok(nodes.long.height <= 80)
    assert.ok(nodes.decision.height >= 88)
    assert.ok(nodes.long.position.y >= nodes.short.position.y + nodes.short.height)
    assert.ok(nodes.decision.position.y >= nodes.long.position.y + nodes.long.height)
  }
})
