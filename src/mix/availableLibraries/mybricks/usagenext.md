# mybricks
- 内置的核心类库，对于页面、浮层（弹窗/抽屉等）、APP声明、数据源、接口以及页面路由相关功能必须使用此库

## 使用指南
- 所有页面都需要通过 comRef 包装，无需导出；
- 所有组件和模块都需要使用 comRef 包装，无需导出;
- 所有浮层类组件（弹窗/抽屉等）都需要使用 popupRef 包装，这样可以在设计态进行展示，无需导出;

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
页面同样需要通过 comRef 包裹实现
  1. 该组件默认接收<保留字段>；
  2. 该页面是一个响应式页面，页面内使用store中的数据时，数据变更会自动刷新页面；

### 浮层类组件声明
浮层类组件（弹窗、抽屉等）必须通过 popupRef 包裹实现，popupRef是MyBricks提供的高阶函数，用于创建一个浮层类组件。
  1. 该组件默认接收<保留字段>；
  2. 该浮层类组件是一个响应式浮层类组件，浮层类组件内使用store中的数据时，数据变更会自动刷新浮层类组件；

> 对于浮层类组件，如弹窗、抽屉等，控制浮层的显示/打开/弹出/隐藏状态的变量必须维护在 store 中，这类状态禁止设置一个固定的值；
> 浮层类组件不是路由页面，浮层必须使用 \`popupRef\` 包裹，作为普通子组件挂载在所属页面或组件内；

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

实现示例
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

数据源采用渐进式声明，按需要的复杂度逐步升级：
1.起步阶段，无需接口：静态数据可以直接写死在代码中，或者在 dataSource.js 中 return 写死，此阶段无需 setup.js；
2.进阶阶段，需要真实接口时：如果用户需要明确需要使用http接口，在 dataSource.js 中用 this.axios 发起接口请求，同时在 setup.js 声明 mock 环境，劫持方法以保证设计态可渲染；

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
  // 静态数据示例
  async getConfig() {
    return { theme: 'dark', version: '1.0.0' }
  }

  // 真实接口示例，用 this.axios 发请求（不要自己 import axios）
  // this.axios 是 DataSource 基类内置的独立 axios 实例，与其他组件隔离
  async getUserById({ id }) {
    return this.axios.get('/query', { params: { id } })
      .then(res => res.status == 200 ? res.data : null)
  }

  // 真实接口示例
  async createUser(data) {
    return this.axios.post('/add', data)
  }
}

export default new MyDatasource()
```

### 环境声明（setup.js）
> 何时需要 setup.js：**当且仅当 dataSource.js 中存在动态接口（this.axios）时**才需要。纯静态数据的项目可以完全不写 setup.js。

一旦引入了动态接口，`setup.js` 就用于声明多套运行环境，此时**必须包含 `mock` 环境（设计态自动激活）**，其余环境按需实现：
1. 设计态（mock）：axios 在设计态无法调用，需劫持动态接口以保证设计态正常返回；
2. 正式环境：使用 dataSource.js 中定义的静态数据和接口请求；
3. N 套自定义环境：用户需要时声明，比如特殊环境和特殊测试场景。

下面的例子里 dataSource 有三个方法，但 mock 环境只需要「增量劫持动态接口」：
1. getConfig 是静态数据，设计态可直接展示，无需 spy；
2. getUserById / createUser 是动态接口，设计态请求不到，需要 mock 返回以保证渲染。

```js
import { describe, spyOn } from 'mybricks/testing'
import dataSource from './dataSource'

// 用户使用了getUserById，所以需要设计态 mock 环境
describe('mock', () => {
  // getUserById 返回 mockReturn 就给 User
  spyOn(dataSource, 'getUserById').mockReturn({
    status: 200,
    data: { id: 1, name: '张三', age: 18 },
  })

  // createUser 返回 { status, data } mockReturn 就给 { status, data }
  spyOn(dataSource, 'createUser').mockReturn({
    status: 200,
    data: {
      code: 1,
      message: 'success'
    }
  })
})

// 按需：用户需要的话，需要配置中文名
describe('预发环境', () => {
  // 预发请求staging环境接口和特殊headers
  dataSource.axios.defaults.baseURL = 'https://api.staging.com';
  dataSource.axios.defaults.headers.common['x-env'] = 'staging';
})

// 按需：用户需要的话，需要配置中文名
describe('游客角色测试', () => {
  // getUserById 返回值为 { username, age } 结构，按照此结构模拟
  spyOn(dataSource, 'getUserById').mockReturn({
    username: '李四',
    age: 20
  })

  // createUser 返回值为 axios 原始返回，包含http的status，按照此结构模拟
  spyOn(dataSource, 'createUser').mockReturn({
    status: 403,
    data: {
      code: 'FORBIDDEN',
      message: '没有权限'
    }
  })
})
```

#### spyOn 使用原则
- spyOn的有且只有一个使用方式，就是 `mockReturn`，不得使用任何其他不存在的方法；
- mockReturn 可显式声明返回类型 `mockReturn<T>(value: T)`，T 即该方法的返回类型；
- `spyOn(dataSource, 'method').mockReturn(value: Record<string, any>): Promise<value>`：可以替换该单个方法的返回值，**value 必须为 对象**；
- `describe` 回调里可以做任意副作用：操作 `dataSource.axios.defaults`、写 localStorage 等；

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
