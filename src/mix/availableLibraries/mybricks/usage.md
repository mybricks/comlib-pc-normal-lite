# mybricks
- 内置的核心类库，对于页面、浮层（弹窗/抽屉等）、APP声明、数据源、接口以及页面路由相关功能必须使用此库

## 使用指南
- 所有页面都需要通过 Route + comRef 包装，无需导出；
- 所有组件和模块都需要使用 comRef 包装，无需导出;
- 所有浮层类组件（弹窗/抽屉等）都需要使用 popupRef 包装，这样可以在设计态进行展示，无需导出;
- 路由通过 Routes + Route 进行渲染；
- 所有数据源（接口请求、静态数据）的声明和使用方式都需要通过 dataSource + setup 文件声明；
- 必须维护一个 dataSource.js 文件用于存放正式环境数据；
- 必须维护一个 setup.js 来保证多环境测试，其中mock环境是必须的；

### 项目声明
项目必须export default 一个由 appRef 包裹的实现

### 组件声明
组件必须通过 comRef 包裹实现，经过comRef包裹的组件会携带一些保留字段
<保留字段>
  1. _env，环境变量
    - _env.mode: 运行环境，design|runtime
  2. popupNode，浮层挂载目标 DOM 节点，type PopupNode = HTMLElement
    - 值为真实 DOM 元素；是浮层类组件（例如常见的弹窗、抽屉等）的挂载节点，且必须挂载到 popupNode 上；
</保留字段>

组件 props 禁止传递<保留字段>以及 store 数据；
- 错误：\`<UserInfo _env={_env} store={store} popupNode={popupNode} user={store.user}/>\`
- 正确：\`<UserInfo />\`

### 页面声明
页面同样需要通过 comRef 包裹实现，但是需要被 Route 注册为页面
  1. 该组件默认接收<保留字段>；
  2. 该页面是一个响应式页面，页面内使用store中的数据时，数据变更会自动刷新页面；

### 浮层类组件声明
浮层类组件（弹窗、抽屉等）必须通过 popupRef 包裹实现，popupRef是MyBricks提供的高阶函数，用于创建一个浮层类组件。
  1. 该组件默认接收<保留字段>；
  2. 该浮层类组件是一个响应式浮层类组件，浮层类组件内使用store中的数据时，数据变更会自动刷新浮层类组件；

> 对于浮层类组件，如弹窗、抽屉等，控制浮层的显示/打开/弹出/隐藏状态的变量必须维护在 store 中，这类状态禁止设置一个固定的值；
> 浮层类组件不是路由页面，禁止将其注册为 \`Route\`；浮层必须使用 \`popupRef\` 包裹，作为普通子组件挂载在所属页面或组件内；

#### PopupVisible装饰器
PopupVisible 是一个属性装饰器，用于将浮层类组件在**设计态**下默认保持**打开状态**，这样设计者才能选中浮层内部的元素进行编辑；

#### 浮层使用

在store.js中声明开关
```js
import { PopupVisible } from 'mybricks'

export default class Store {
  @PopupVisible
  modalVisible = false;
}
```

在jsx中
原生实现
```jsx
import ReactDOM from 'react-dom';
import store from './store';
import { popupRef } from 'mybricks'

const ConfirmModal = popupRef(({ popupNode }) => {
  return ReactDOM.createPortal(<div className={css.mask} style={{ display: store.modalVisible ? 'block' : 'none' }}>

  </div>, popupNode)
})
```

基于三方库
```jsx
import { popupRef } from 'mybricks'
import store from './store';
import { Modal } from 'lib'

const ConfirmModal = popupRef(({ popupNode }) => {
  return (
    <Modal
      visible={store.modalVisible}
      getContainer={() => popupNode}
    />
  )
})
```

### 数据源使用
所有正式数据（接口请求、静态数据）必须维护在 `dataSource.js` 文件中。

通过继承 `DataSource` 基类并 `export default new MyDatasource()` 来声明数据源；

怎么声明数据源：
1. 判断用户是否提供接口信息，对于提供了接口信息的，使用 `this.axios` 发起请求；
2. 对于未提供接口信息的，思考哪些应该属于接口信息，用静态数据来return返回，为以后开发留下坑位，保障运行态也能看见数据；


```js DataSource 说明
// DataSource 基类：mybricks 提供，构造时对所有子类方法自动做 Proxy 拦截，
class DataSource {
  constructor() { /* 对所有方法自动 Proxy 包装 */ }
}
```

dataSource.js 文件示例：
```js
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
  }

  async createUser(data) {
    return this.axios.post('/createUser', data)
  }
}

export default new MyDatasource()
```

### 环境声明（setup.js）
`setup.js` 用于声明多套运行环境，**必须包含 `mock` 环境（设计态自动激活）**，其余环境根据用户需求按需来实现。

一共需要关心 设计态 + 运行态（正式环境 + N套自定义环境）：
1. 搭建环境：使用 mock 定义，由于axios在设计态无法调用，我们需要劫持动态数据的接口以保证设计态的正常返回
2. 正式环境：使用 dataSource.js 中定义的静态数据和接口请求；
3. N套自定义环境：用户需要时声明，比如特殊环境和特殊测试场景；

比如下面的代码，虽然 dataSource.js 有两个方法，但是对于mock环境来说，只需要增量劫持：
1. getConfig 返回的是静态数据，设计态可以展示，无需spy；
2. getUserById 在设计态无法请求真实接口，所以需要mock一个接口返回，保证设计态渲染；

```js
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
  dataSource.axios.baseURL = 'https://api.staging.com';
  dataSource.axios.headers.common['x-env'] = 'staging';
})

// 按需：用户需要的话，需要配置中文名
describe('无权限测试', () => {
  // 测试接口403情况
  spyOn(dataSource, 'getUserById').mockReturn({
    status: 403,
  })
})
```

#### spyOn 使用原则
- spyOn的有且只有一个使用方式，就是 `mockReturn`，不得使用任何其他不存在的方法；
- `spyOn(dataSource, 'method').mockReturn(value: Record<string, any>): Promise<value>`：可以替换该单个方法的返回值，**value 必须为 对象**；
- 仅必要时使用，比如由于设计态无法请求真实接口，需要劫持axios接口调用，不要劫持静态数据方法；
- `describe` 回调里可以做任意副作用：操作 `dataSource.axios.defaults`、写 localStorage 等；
- **必须声明 `mock` 环境**（设计态自动激活）；

### 路由使用
对于路由，我们提供 `Routes`、`Route`、`useNavigate`、`useLocation`、`useParams` 实现。

```jsx
import { comRef, appRef, Routes, Route, useNavigate, useLocation, useParams } from 'mybricks';
import { Button } from 'xy-ui';
import store from './store';
import css from 'style.less';

/**
 * @summary 工具条
 */
const ToolBar = comRef(() => {
  const navigate = useNavigate();
  const location = useLocation(); // { pathname, search, hash, state }
  return store.btns.map((btn) => (
    <Button
      key={btn.text}
      className={location.pathname === btn.path ? css.btnActive : css.btn}
      onClick={() => navigate(btn.path)}
    >{btn.text}</Button>
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
  const user = store.users.find((u) => String(u.id) === id);
  return <div>{user?.name}</div>;
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
```

### 日志
对于日志，我们提供了 `logger` 工具。

#### 支持的方法

| 方法 | 说明 | 适用场景 |
|------|------|---------|
| `logger.log(msg, ...args)` | 普通日志 | 一般性信息输出 |
| `logger.info(msg, ...args)` | 信息日志 | 关键业务节点记录 |
| `logger.warn(msg, ...args)` | 警告日志 | 非预期但可兼容的情况 |
| `logger.error(msg, ...args)` | 错误日志 | 异常和错误信息 |

#### 使用示例
```js
import { logger } from 'mybricks';
logger.info('这是一条日志');
```

### 数据响应式
基于 store.js 的响应式编程，我们提供了 `makeAutoObservable` 状态管理工具。

#### 使用示例
构造函数 constructor 内部必须调用 makeAutoObservable 方法，并传入 this 作为参数，自动绑定当前实例的所有属性为可观察状态，所有方法为动作方法，严格遵循状态管理规范，保证响应式逻辑生效；
```js
import { logger, makeAutoObservable } from 'mybricks';

class Store {
  loading = false;

  constructor() {
    makeAutoObservable(this);
  }

  click() {
    logger.info('[Store/click] 按钮点击');
  }
  
  setLoading(loading) {
    logger.info('[Store/setLoading] 设置loading状态', loading);
    this.loading = loading;
  }
}

export default new Store();
```
