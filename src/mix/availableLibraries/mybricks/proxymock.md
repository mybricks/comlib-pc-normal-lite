### 页面展示状态覆盖与交互脚本
项目设计态提供全局响应式对象 `window._proxy_`，用于临时覆盖 UI 展示数据，例如列表、加载状态、错误状态或文案。运行态会忽略这些覆盖值，始终使用原有展示逻辑。React 组件在设计态渲染过程中读取 `window._proxy_.xxx` 后，对该顶层属性重新赋值可以触发依赖它的 UI 更新。`false`、`0`、空字符串、空数组和 `null` 都可能是有意设置的展示值。

它只影响页面显示，不改变正式数据源、请求、状态更新或其他业务流程。默认没有设置覆盖值时，页面沿用原有数据和展示逻辑。组件从 React 状态或自定义 Hook 取得的展示值可以作为 mock 场景的候选；由 props 传入的展示值，应追溯到调用侧的数据来源并在那里接入覆盖。是否接入以及需要覆盖哪些展示数据，由后续具体任务决定。

当需求提供 DOM 节点信息时，严格以指定节点为处理范围，不扩展到其他节点；没有提供节点信息时，按需求描述确定处理范围。检查相关位置实际展示了哪些可变化的数据，仅为有意义的场景接入 `window._proxy_`。即使需要追溯到调用侧修改代码，交互脚本仍应对应需求指定的展示位置。`data-zone-status` 仅提示组件自身存在状态来源；仅使用 props 的组件不会因此被标记，也不表示所有 Hook 返回值都需要覆盖。

接入时以 `window._proxy_.xxx !== undefined` 判断是否启用覆盖，避免把 `false`、`0`、`''`、`[]` 或 `null` 误认为未设置。直接在组件渲染过程中读取对应属性，不解构、缓存或重新赋值 `window._proxy_`。只在展示位置使用覆盖值，原有数据获取、事件处理及派生计算继续使用原值。

例如父组件将展示文案传给子组件时，在调用侧选择展示值，子组件保持使用原 props：

```tsx
const UserHeader = ({ title }) => <h2>{title}</h2>

const Page = () => {
  const [title] = useState('用户中心')
  const displayedTitle =
    window._proxy_.title !== undefined
      ? window._proxy_.title
      : title

  return <UserHeader title={displayedTitle} />
}
```

示例一：自定义 Hook 返回的 `loading` 只用于展示时，可以给原值取别名，让 JSX 继续使用原变量名；Hook 调用本身不变。

```tsx
const { loading: originalLoading, users } = useUsers()
const loading =
  window._proxy_.loading !== undefined
    ? window._proxy_.loading
    : originalLoading

return <div className={styles.status}>{loading ? '加载中' : `${users.length} 位用户`}</div>
```

示例二：列表经过筛选等计算，或原变量还参与业务逻辑时，保留原绑定及计算过程，另定义仅供展示使用的变量；列表内容和空状态判断使用同一个展示变量。

```tsx
const filteredUsers = useMemo(
  () => users.filter(user => user.name.includes(keyword)),
  [users, keyword]
)
const displayedUsers =
  window._proxy_.users !== undefined
    ? window._proxy_.users
    : filteredUsers

return displayedUsers.length === 0
  ? <div className={styles.empty}>暂无用户</div>
  : <div className={styles.list}>
      {displayedUsers.map(user => <div className={styles.user} key={user.id}>{user.name}</div>)}
    </div>
```

设计态交互脚本通过顶层属性赋值更新展示，例如 `window._proxy_.users = [{ id: '1', name: '张三' }];`。不要只修改数组或对象内部的数据。以上仅为写法示例，不表示所有页面都需要接入这些字段。

需要接入覆盖时，先完成相关 TSX 修改，再查看修改后的代码，确认实际展示位置及其最终行号，最后更新项目根目录下的 `.agent/proxy-mock/interactive-scripts.yaml`。不要预估修改前的行号。文件内容解析后是一个数组，每个顶层项对应一个真实 JSX 位置，包含 `fileName`、`loc` 和 `scripts`。需求提供 DOM 节点信息时，仅新增或更新指定节点对应的记录，保留其他位置的记录；未提供节点信息时，按需求涉及的展示位置维护记录。已有相同 `fileName` 与 `loc` 时，将场景合并到该项的 `scripts` 数组；位置因代码修改而变化时，更新对应记录的 `loc`：
- `fileName`：实际使用该展示值的 TSX 文件路径，相对于项目根目录；
- `loc`：该展示值对应的真实 JSX 标签位置，格式为 `标签名:起始行-结束行`，例如 `div:42-44`。行号以最终代码为准，不写变量声明的位置；
- `scripts`：场景数组，每项包含 `title` 和 `script`。`title` 是执行后用户可看到的场景名称；`script` 是可独立执行的 JavaScript 字符串，用顶层属性赋值设置 `window._proxy_`。

例如，某页面的用户列表在 `pages/Users/index.tsx` 第 42 至 44 行的 `div` 中展示时，可以写为：

```yaml
- fileName: pages/Users/index.tsx
  loc: "div:42-44"
  scripts:
    - title: 展示空用户列表
      script: |
        window._proxy_.users = [];
```

示例中的路径和行号仅说明格式；实际记录必须匹配修改后的代码。不要为需求范围外的位置添加场景，也不要记录代码中不存在的场景。
