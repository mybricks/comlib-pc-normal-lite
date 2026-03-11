# mybricks
- 内置的核心类库，对于组件、页面、APP声明以及路由相关功能必须使用此组件

## 使用指南

### 项目声明
项目必须export default 一个由 appRef 包裹的实现

### 组件声明
组件必须通过 comRef

### 页面声明
页面必须通过 pageRef 包裹实现


### 接口使用
对于所有的接口，都必须维护到services.js文件中，我们提供了 `createEnvs` + `createAPI`，对axios做了代理，所有接口和环境必须通过这两个函数来定义。

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
import { comRef, pageRef, appRef, Routes, Route, useNavigate, useLocation, useParams } from 'mybricks';
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

const PageButton = pageRef(() => (
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

const PageUser = pageRef(() => <UserDetail />);

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
