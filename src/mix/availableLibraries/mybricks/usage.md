# mybricks
- 内置的核心类库，对于组件、页面、浮层（弹窗/抽屉等）、APP声明以及路由相关功能必须使用此组件

## 使用指南
- 所有页面都需要通过 Route + comRef 包装，无需导出；
- 所有组件和模块都需要使用 comRef 包装，无需导出;
- 所有浮层类组件（弹窗/抽屉等）都需要使用 popupRef 包装，这样可以在设计态进行展示，无需导出;
- 路由通过 Routes + Route 进行渲染；

### 项目声明
项目必须export default 一个由 appRef 包裹的实现

### 组件声明
组件必须通过 comRef 包裹实现，经过comRef包裹的组件会携带一些保留字段
<保留字段>
  1. _env，环境变量
    - _env.mode: 运行环境，design|runtime
  2. popupNode，浮层挂载目标 DOM 节点，type PopupNode = HTMLElement
    - 值为真实 DOM 元素；浮层须挂到 popupNode，例如 getContainer={() => popupNode} 或 createPortal(..., popupNode)；
    - 通常三方库会有 prop 支持；当原生html实现时，可使用 react-dom 提供的 createPortal 方法实现挂载；
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

在runtime.jsx中
```jsx
import ReactDOM from 'react-dom';
import { popupRef } from 'mybricks'

const ConfirmModal = popupRef(({ store, popupNode }) => {
  return ReactDOM.createPortal(<div className={css.mask} style={{ display: store.modalVisible ? 'block' : 'none' }}>

  </div>, popupNode)
})
```

### 接口使用
对于所有的接口，都必须维护到service.js文件中，我们提供了 `createEnvs` + `createAPI`，对axios做了代理，所有接口和环境必须通过这两个函数来定义。

```js createEnvs 和 createAPI的源代码说明
// createEnvs：本质是 axios.create，注册多套环境实例，实例隐式切换后被 createAPI 消费
function createEnvs(envConfigs) {
  Object.entries(envConfigs).forEach(([key, { title, baseUrl, ...rest }]) => {
    envInstances[key] = axios.create({ baseURL: baseUrl, ...rest })
  })
}

// createAPI：返回一个函数，调用时合并配置并用当前环境实例发请求，其中defaultConfig的method、url、summary必须
function createAPI(defaultConfig, paramsMapper) {
  return (params) => {
    const runtimeConfig = paramsMapper ? paramsMapper(params) : {}
    return getCurrentInstance()({ ...defaultConfig, ...runtimeConfig })
  }
}
```


service.js文件示例
```js
import { createEnvs, createAPI } from 'mybricks'

createEnvs({
  prod: {
    title: '正式环境',
    baseUrl: 'https://www.xxx.com/api',
    headers: {
      'x-id': '正式环境固定headers'
    },
  }
})


const getUserById = createAPI({
  method: 'GET',
  url: '/getUserById',
  summary: '根据ID请求用户信息'
}, ({ id }) => {
  return {
    params: {
      id
    }
  }
}).then()


export default {
  getUserById,
}
```

### 路由使用
对于路由，我们提供 `Routes`、`Route`、`useNavigate`、`useLocation`、`useParams` 实现。

```jsx
import { comRef, appRef, Routes, Route, useNavigate, useLocation, useParams } from 'mybricks';
import { Button } from 'xy-ui';
import css from 'style.less';

/**
 * @summary 工具条
 */
const ToolBar = comRef(({ store }) => {
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
const UserDetail = comRef(({ store }) => {
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
