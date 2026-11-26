import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'

async function load(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)
}
const { parseDiagram, hideRelationRoot } = await load('src/mix/understand-any/diagram/parse.ts')

test('flowchart retains multiple valid anchors and ignores invalid or orphan annotations', () => {
  const diagram = parseDiagram('```mermaid\nflowchart LR\n  A[金额] --> B[文本]\n  %% @ui B file="src/Card.tsx" loc="span:42"\n  %% @ui B file="src/Card.tsx" loc="Button:51-55"\n  %% @ui B file="../outside.tsx" loc="span:3"\n  %% @ui B file="src/Card.tsx" loc="span:55-51"\n  %% @ui C file="src/Card.tsx" loc="span:1"\n```')
  assert.deepEqual(diagram.nodes.find(node => node.id === 'B').ui, [
    { file: 'src/Card.tsx', tag: 'span', startLine: 42, endLine: 42 },
    { file: 'src/Card.tsx', tag: 'Button', startLine: 51, endLine: 55 },
  ])
  assert.equal(diagram.edges.length, 1)
})

test('multiline node labels keep the workbench diagram and UI anchors in the React Flow parser', () => {
  const diagram = parseDiagram(`\`\`\`mermaid
flowchart TD
  HOME[首页工作台 /] -->|首次进入| LOAD{概览数据是否准备完成}
  LOAD -->|未完成| LOADING[显示加载提示]
  LOAD -->|加载概览数据| OVERVIEW[工作台概览数据
当前为本地模拟返回]
  OVERVIEW -->|shopName、shopTag、greeting| WELCOME[欢迎区域：店铺名称、商家标签和经营提醒]
  OVERVIEW -->|summary| SUMMARY[经营数据概览：支付订单、待发货、销售额和售后待处理]
  OVERVIEW -->|trend| TREND[近 7 日成交订单趋势]
  OVERVIEW -->|recentOrders| RECENT[最近订单列表]
  OVERVIEW -->|todos| TODO[待办事项]
  OVERVIEW -->|notices| NOTICE[平台公告]
  LOGIN_ENTRY[点击顶部登录] --> LOGIN_FORM[填写商家账号和密码]
  LOGIN_FORM -->|表单校验通过| LOGIN[登录校验
当前为本地模拟返回]
  LOGIN -->|账号非空且密码不少于 6 位| LOGIN_SUCCESS[返回用户名 张老板]
  LOGIN_SUCCESS --> USER_GREETING[顶部显示用户名问候]
  LOGIN -->|账号为空或密码不足 6 位| LOGIN_FAIL[显示账号或密码错误提示]
  %% @ui LOADING file="pages/Workbench/index.tsx" loc="div:399-403"
  %% @ui WELCOME file="pages/Workbench/index.tsx" loc="section:86-102"
  %% @ui USER_GREETING file="pages/Workbench/index.tsx" loc="div:54-62"
\`\`\``)
  assert.equal(diagram.kind, 'flowchart')
  assert.equal(diagram.direction, 'TB')
  assert.equal(diagram.nodes.find(node => node.id === 'OVERVIEW').label, '工作台概览数据 当前为本地模拟返回')
  assert.equal(diagram.nodes.find(node => node.id === 'LOGIN').label, '登录校验 当前为本地模拟返回')
  assert.equal(diagram.nodes.find(node => node.id === 'WELCOME').ui[0].file, 'pages/Workbench/index.tsx')
  assert.equal(diagram.edges.length, 14)
})

test('semicolons in quoted labels do not split statements', () => {
  const diagram = parseDiagram('```mermaid\nflowchart LR; A["金额; 元"] --> B[金额]\n```')
  assert.equal(diagram.nodes[0].label, '金额; 元')
  assert.equal(diagram.edges.length, 1)
})

test('mindmap UI annotations bind stable explicit IDs without changing the hierarchy', () => {
  const diagram = parseDiagram(`\`\`\`mermaid
mindmap
  root((订单接口))
    订单金额 total
      PRICE[订单金额文本]
    订单状态 status
      BADGE[状态标签内容]
      CANCEL[取消按钮：待付款时显示]
  %% @ui PRICE file="src/OrderCard.tsx" loc="span:42"
  %% @ui CANCEL file="src/OrderCard.tsx" loc="Button:51-55"
  %% @ui CANCEL file="src/OrderCard.tsx" loc="Button:60"
\`\`\``)
  assert.equal(diagram.kind, 'mindmap')
  assert.equal(diagram.nodes.find(node => node.id === 'PRICE').label, '订单金额文本')
  assert.equal(diagram.nodes.find(node => node.id === 'PRICE').ui[0].startLine, 42)
  assert.equal(diagram.nodes.find(node => node.id === 'CANCEL').ui.length, 2)
  assert.equal(diagram.nodes.find(node => node.id === 'BADGE').ui, undefined)
  assert.equal(diagram.edges.length, 5)
  assert.equal(diagram.nodes.find(node => node.id === diagram.edges.find(edge => edge.target === 'CANCEL').source).label, '订单状态 status')
})

test('repeated UI nodes remain separate mindmap branches and share their anchor', () => {
  const diagram = parseDiagram(`\`\`\`mermaid
mindmap
  root((首页工作台数据与界面关系))
    工作台概览数据
      店铺名称 shopName
        WELCOME_NAME[欢迎区域的店铺名称]
    登录校验数据
      登录是否成功 success
        LOGIN_MESSAGE[登录结果提示]
      登录提示内容 message
        LOGIN_MESSAGE[登录结果提示]
      登录用户名 userName
        USER_GREETING[顶部用户问候]
  %% @ui WELCOME_NAME file="pages/Workbench/index.tsx" loc="h1:89"
  %% @ui LOGIN_MESSAGE file="pages/Workbench/index.tsx" loc="div:51"
  %% @ui USER_GREETING file="pages/Workbench/index.tsx" loc="span:56"
\`\`\``)
  const messages = diagram.nodes.filter(node => node.label === '登录结果提示')
  assert.equal(messages.length, 2)
  assert.notEqual(messages[0].id, messages[1].id)
  assert.ok(messages.every(node => node.ui?.[0].startLine === 51))
  assert.deepEqual(messages.map(node => diagram.nodes.find(item => item.id === diagram.edges.find(edge => edge.target === node.id).source).label), ['登录是否成功 success', '登录提示内容 message'])
  assert.equal(diagram.nodes.find(node => node.id === 'WELCOME_NAME').ui[0].tag, 'h1')
})

test('ambiguous repeated IDs do not attach an anchor to different UI labels', () => {
  const diagram = parseDiagram('```mermaid\nmindmap\n  root((订单))\n    A[金额]\n    A[状态]\n  %% @ui A file="src/Order.tsx" loc="span:3"\n```')
  assert.equal(diagram.nodes.filter(node => node.id.startsWith('A')).length, 2)
  assert.ok(diagram.nodes.every(node => !node.ui))
})

test('source and field annotations retain API routes, local methods, and variable names', () => {
  const diagram = parseDiagram(`\`\`\`mermaid
mindmap
  root((订单数据与界面))
    API[订单详情接口]
      TOTAL[订单金额]
        PRICE[订单金额文本]
    LOCAL[订单状态数据]
      STATUS[订单状态]
        BADGE[状态标签内容]
  %% @source API bind="GET /api/orders/:id"
  %% @source LOCAL bind="getOrderStatus"
  %% @field TOTAL bind="total"
  %% @field STATUS bind="status"
  %% @ui PRICE file="src/OrderCard.tsx" loc="span:42"
\`\`\``)
  const get = id => diagram.nodes.find(node => node.id === id)
  assert.deepEqual(get('API').source, { bind: 'GET /api/orders/:id' })
  assert.deepEqual(get('LOCAL').source, { bind: 'getOrderStatus' })
  assert.deepEqual(get('TOTAL').field, { bind: 'total' })
  assert.deepEqual(get('STATUS').field, { bind: 'status' })
  assert.equal(get('PRICE').ui[0].startLine, 42)
  const flow = parseDiagram('```mermaid\nflowchart LR\n  API[接口] --> TOTAL[金额]\n  %% @source API bind="GET /orders"\n  %% @field TOTAL bind="total"\n```')
  assert.equal(flow.nodes.find(node => node.id === 'API').source.bind, 'GET /orders')
  assert.equal(flow.nodes.find(node => node.id === 'TOTAL').field.bind, 'total')
})


test('mindmap supports multiple data sources as independent top-level nodes', () => {
  const diagram = parseDiagram(`\`\`\`mermaid
mindmap
  API[订单详情接口]
    TOTAL[订单金额]
      PRICE[金额文本]
  LOCAL[订单状态数据]
    STATUS[订单状态]
      BADGE[状态标签]
  %% @source API bind="GET /orders"
  %% @source LOCAL bind="getOrderStatus"
  %% @field TOTAL bind="total"
  %% @field STATUS bind="status"
  %% @ui PRICE file="src/Order.tsx" loc="span:42"
  %% @ui BADGE file="src/Order.tsx" loc="span:50"
\`\`\``)
  assert.deepEqual(diagram.nodes.filter(node => node.depth === 0).map(node => node.id), ['API', 'LOCAL'])
  assert.equal(diagram.nodes.length, 6)
  assert.equal(diagram.edges.length, 4)
  assert.equal(diagram.nodes.find(node => node.id === 'API').source.bind, 'GET /orders')
  assert.equal(diagram.nodes.find(node => node.id === 'BADGE').ui[0].startLine, 50)
})


test('relation view hides a shared root while preserving source bindings and branches', () => {
  const diagram = parseDiagram(`\`\`\`mermaid
mindmap
  root((订单关系))
    API[订单接口]
      TOTAL[订单金额]
        PRICE[金额文本]
    LOCAL[订单状态]
      STATUS[状态]
  %% @source API bind="GET /orders"
  %% @source LOCAL bind="getStatus"
  %% @field TOTAL bind="total"
  %% @ui PRICE file="src/Order.tsx" loc="span:42"
\`\`\``)
  const view = hideRelationRoot(diagram)
  assert.equal(diagram.nodes.length, 6)
  assert.deepEqual(view.nodes.filter(node => node.depth === 0).map(node => node.id), ['API', 'LOCAL'])
  assert.equal(view.nodes.find(node => node.id === 'TOTAL').depth, 1)
  assert.equal(view.nodes.find(node => node.id === 'PRICE').ui[0].startLine, 42)
  assert.deepEqual(view.edges.map(edge => [edge.source, edge.target]), [['API', 'TOTAL'], ['TOTAL', 'PRICE'], ['LOCAL', 'STATUS']])
})

test('relation view keeps normal mindmap roots and roots that are data sources', () => {
  const ordinary = parseDiagram('```mermaid\nmindmap\n  root((页面功能))\n    首页\n      搜索\n```')
  assert.equal(hideRelationRoot(ordinary), ordinary)
  const source = parseDiagram('```mermaid\nmindmap\n  API[订单接口]\n    TOTAL[金额]\n  %% @source API bind="GET /orders"\n  %% @field TOTAL bind="total"\n```')
  assert.equal(hideRelationRoot(source), source)
  const mixed = parseDiagram('```mermaid\nmindmap\n  root((页面))\n    API[订单接口]\n    其他功能\n  %% @source API bind="GET /orders"\n```')
  assert.equal(hideRelationRoot(mixed), mixed)
})
