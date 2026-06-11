export function getMybricksUsage() {
  return `# mybricks
- 内置的核心类库，对于页面、浮层（弹窗/抽屉等）、APP声明、数据源、接口以及页面路由相关功能必须使用此库

## 使用指南
- 所有页面都需要通过 Route + comRef 包装，无需导出；
- 所有组件和模块都需要使用 comRef 包装，无需导出;
- 所有浮层类组件（弹窗/抽屉等）都需要使用 popupRef 包装，这样可以在设计态进行展示，无需导出;
- 路由通过 Routes + Route 进行渲染；
- 所有数据源（接口请求、静态数据）的声明和使用方式都需要通过 dataSource + setup 文件声明；
- 必须维护一个 dataSource.ts 文件用于存放正式环境数据；
- 必须维护一个 setup.ts 来保证多环境测试，其中mock环境是必须的；

### 项目声明
项目必须export default 一个由 appRef 包裹的实现

### 组件声明
组件必须通过 comRef 包裹实现

\`\`\`ts
comRef(baseComponent: FunctionComponent<Props>): FunctionComponent<Props>
\`\`\`

### 页面声明
页面同样需要通过 comRef 包裹实现，但是需要被 Route 注册为页面

### 浮层类组件声明
浮层类组件（弹窗、抽屉等）必须通过 popupRef 包裹实现，popupRef是MyBricks提供的高阶函数，用于创建一个浮层类组件。

\`\`\`ts
popupRef(baseComponent: FunctionComponent<Props>): FunctionComponent<Props>
\`\`\`

> 浮层类组件不是路由页面，禁止将其注册为 \`Route\`；浮层必须使用 \`popupRef\` 包裹，作为普通子组件挂载在所属页面或组件内；

#### 浮层使用
在代码中使用浮层类组件时必须使用环境变量，这样设计者才能选中浮层内部的元素进行编辑

> **重要**：\`process.env.POPUP_VISIBLE\` 和 \`process.env.POPUP_NODE\` 这两个环境变量**只能在 \`popupRef\` 包裹的组件内部使用**。这是因为运行时会将它们替换为 \`popupRef\` 注入的内部变量，若在 \`popupRef\` 外使用会导致运行时报错。

  - \`visible\` 属性：必须先写 \`process.env.POPUP_VISIBLE\`，再用 \`||\` 跟上真实控制 visible 的变量
  - \`getContainer\` 属性：必须先写 \`process.env.POPUP_NODE\`，如果还需要变量控制挂载节点，同样用 \`||\` 跟在后面
\`\`\`tsx
import { popupRef } from 'mybricks'
import { Modal } from 'lib'

const ConfirmModal = popupRef(({ visible }) => {
  return (
    <Modal
      visible={process.env.POPUP_VISIBLE || visible}
      getContainer={() => process.env.POPUP_NODE}
    />
  )
})
\`\`\`


### 数据源使用
所有正式数据（接口请求、静态数据）必须维护在 \`dataSource.ts\` 文件中。

通过继承 \`DataSource\` 基类并 \`export default new MyDatasource()\` 来声明数据源；

怎么声明数据源：
1. 判断用户是否提供接口信息，对于提供了接口信息的，使用 \`this.axios\` 发起请求；
2. 对于未提供接口信息的，思考哪些应该属于接口信息，用静态数据来return返回，为以后开发留下坑位，保障运行态也能看见数据；


\`\`\`ts DataSource 说明
// DataSource 基类：mybricks 提供，提供了axios对象注入，
class DataSource {
  constructor() {}
}
\`\`\`

dataSource.ts 文件示例：
\`\`\`ts
import { DataSource } from 'mybricks'

class MyDatasource extends DataSource {
  // 场景一：静态数据
  async getConfig() {
    return { theme: 'dark', version: '1.0.0' }
  }

  // 场景二：真实接口，用 this.axios 发请求（不要自己 import axios）
  // this.axios 是 DataSource 基类内置的独立 axios 实例，与其他组件隔离
  async getUserById({ id }) {
    return this.axios.get('/getUserById', { params: { id } })
      .then(res => res.status == 200 ? res.data : null)
  }

  async createUser(data) {
    return this.axios.post('/createUser', data)
  }
}

export default new MyDatasource()
\`\`\`

### 环境声明（setup.ts）
\`setup.ts\` 用于声明多套运行环境，**必须包含 \`mock\` 环境（设计态自动激活）**，其余环境根据用户需求按需来实现。

一共需要关心 设计态 + 运行态（正式环境 + N套自定义环境）：
1. 搭建环境：使用 mock 定义，由于axios在设计态无法调用，我们需要劫持动态数据的接口以保证设计态的正常返回
2. 正式环境：使用 dataSource.ts 中定义的静态数据和接口请求；
3. N套自定义环境：用户需要时声明，比如特殊环境和特殊测试场景；

比如下面的代码，虽然 dataSource.ts 有两个方法，但是对于mock环境来说，只需要增量劫持：
1. getConfig 返回的是静态数据，设计态可以展示，无需spy；
2. getUserById 在设计态无法请求真实接口，所以需要mock一个接口返回，保证设计态渲染；

\`\`\`ts
import { describe, spyOn } from 'mybricks/testing'
import dataSource from './dataSource'

// 必须：设计态 mock 环境
describe('mock', () => {
  // 上面 getUserById 直接返回一个axios.get，可以确定里面有status、data字段
  spyOn(dataSource, 'getUserById').mockReturn({
    status: 200,
    data: { id: 1, name: '张三', age: 18 },
  })
})

// 按需：用户需要的话，需要配置中文名
describe('预发环境', () => {
  // 预发请求staging环境接口和特殊headers
  dataSource.axios.defaults.baseURL = 'https://api.staging.com';
  dataSource.axios.defaults.headers.common['x-env'] = 'staging';
})

// 按需：用户需要的话，需要配置中文名
describe('无权限测试', () => {
  // 测试接口403情况
  spyOn(dataSource, 'getUserById').mockReturn({
    status: 403,
  })
})
\`\`\`

#### spyOn 使用原则
- spyOn的有且只有一个使用方式，就是 \`mockReturn\`，不得使用任何其他不存在的方法；
- \`spyOn(dataSource, 'method').mockReturn(value: Record<string, any>): Promise<value>\`：可以替换该单个方法的返回值，**value 必须为 对象**；
- 仅必要时使用，比如由于设计态无法请求真实接口，需要劫持axios接口调用，不要劫持静态数据方法；
- \`describe\` 回调里可以做任意副作用：操作 \`dataSource.axios.defaults\`、写 localStorage 等；
- **必须声明 \`mock\` 环境**（设计态自动激活）；

### 路由使用
对于路由，我们提供 \`Routes\`、\`Route\`、\`useNavigate\`、\`useLocation\`、\`useParams\` 实现。

\`\`\`tsx
import { comRef, appRef, Routes, Route, useNavigate, useLocation, useParams } from 'mybricks';
import css from './index.module.less';

const BUTTONS = [
  {
    text: '用户A',
    path: '/user/a'
  },
  {
    text: '用户B',
    path: '/user/b'
  }
]

/**
 * @summary 工具条
 */
const ToolBar = comRef(() => {
  const navigate = useNavigate();
  const location = useLocation(); // { pathname, search, hash, state }
  return BUTTONS.map((btn) => (
    <button
      key={btn.text}
      className={location.pathname === btn.path ? css.btnActive : css.btn}
      onClick={() => navigate(btn.path)}
    >{btn.text}</button>
  ));
});

const PageButton = comRef(() => (
  <div className={css.viewContainer}><ToolBar /></div>
));

/**
 * @summary 用户详情（路由: user/:id）
 */
const UserDetail = comRef(() => {
  const { id } = useParams(); // 读取动态段参数
  return <div>{id}</div>;
});

const PageUser = comRef(() => <UserDetail />);

/**
 * @title 示例项目
 */
export default appRef(() => {
  return (
    <Routes>
      <Route index element={<PageButton />} />
      <Route path="user/:id" element={<PageUser />} />
    </Routes>
  );
});
\`\`\`

### 日志
对于日志，我们提供了 \`logger\` 工具。

#### 支持的方法

| 方法 | 说明 | 适用场景 |
|------|------|---------|
| \`logger.log(msg, ...args)\` | 普通日志 | 一般性信息输出 |
| \`logger.info(msg, ...args)\` | 信息日志 | 关键业务节点记录 |
| \`logger.warn(msg, ...args)\` | 警告日志 | 非预期但可兼容的情况 |
| \`logger.error(msg, ...args)\` | 错误日志 | 异常和错误信息 |

#### 使用示例
\`\`\`ts
import { logger } from 'mybricks';
logger.info('这是一条日志');
\`\`\`
`
}
