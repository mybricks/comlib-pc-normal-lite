### 页面展示状态覆盖与交互脚本
项目设计态提供全局响应式对象 `window._proxy_`，用于临时覆盖 UI 展示数据，例如列表、加载状态、错误状态或文案。`window` 上不一定存在 `_proxy_`，因此组件代码读取覆盖值时必须使用可选链 `window._proxy_?.xxx`，对象不存在时沿用原有展示逻辑。React 组件在设计态渲染过程中读取该属性后，对该顶层属性重新赋值可以触发依赖它的 UI 更新。`false`、`0`、空字符串、空数组和 `null` 都可能是有意设置的展示值。

它只影响页面显示，不改变正式数据源、请求、状态更新或其他业务流程。默认没有设置覆盖值时，页面沿用原有数据和展示逻辑。组件从 React 状态或自定义 Hook 取得的展示值可以作为 mock 场景的候选。由 props 传入的展示值不能停在子组件：应沿 props 和调用链向上追溯，找到父组件状态、Hook 返回值或请求结果等真实来源，并在来源的展示值选择处接入覆盖；如果来源仍由更上层传入，继续向上查找。是否接入以及需要覆盖哪些展示数据，由后续具体任务决定。

当需求提供 DOM 节点信息时，先确认节点代表的范围：创建页面状态时提供的是页面 DOM 容器，应分析该页面内的组件，不扩展到其他页面；其他需求按指定节点或需求描述确定处理范围。以页面中用户能看到的组件为分组单位，检查组件实际展示的可变化数据，仅为有意义的场景接入 `window._proxy_`。如果展示值来自 props，继续向上查找来源并修改来源组件，但交互脚本仍归入展示该状态的组件分组。`data-zone-status` 仅提示组件自身存在状态来源；仅使用 props 的组件不会因此被标记，也不表示所有 Hook 返回值都需要覆盖。

接入时以 `window._proxy_?.xxx !== undefined` 判断是否启用覆盖，避免把 `false`、`0`、`''`、`[]` 或 `null` 误认为未设置。直接在组件渲染过程中用可选链读取对应属性，不解构、缓存或重新赋值 `window._proxy_`。只在展示位置使用覆盖值，原有数据获取、事件处理及派生计算继续使用原值。

例如父组件将展示文案传给子组件时，在调用侧选择展示值，子组件保持使用原 props：

```tsx
const UserHeader = ({ title }) => <h2>{title}</h2>

const Page = () => {
  const [title] = useState('用户中心')
  const displayedTitle =
    window._proxy_?.title !== undefined
      ? window._proxy_?.title
      : title

  return <UserHeader title={displayedTitle} />
}
```

示例：子组件的 `loading` 来自 props 时，先沿调用链向上找到父组件的来源，在父组件选择传给子组件的展示值；不要在子组件内部另造一份覆盖。交互脚本中的字段名对应父组件接入覆盖时使用的字段，但场景分组仍归属于页面中实际展示 loading 的组件。

```tsx
const Stats = ({ loading, total }) => (
  <section>{loading ? '加载中' : `${total} 个`}</section>
)

const Dashboard = () => {
  const { loading: originalLoading, total } = useStats()
  const loading =
    window._proxy_?.statsLoading !== undefined
      ? window._proxy_?.statsLoading
      : originalLoading
  const displayedTotal =
    window._proxy_?.totalOrders !== undefined
      ? window._proxy_?.totalOrders
      : total

  return <Stats loading={loading} total={displayedTotal} />
}
```

示例一：自定义 Hook 返回的 `loading` 只用于展示时，可以给原值取别名，让 JSX 继续使用原变量名；Hook 调用本身不变。

```tsx
const { loading: originalLoading, users } = useUsers()
const loading =
  window._proxy_?.loading !== undefined
    ? window._proxy_?.loading
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
  window._proxy_?.users !== undefined
    ? window._proxy_?.users
    : filteredUsers

return displayedUsers.length === 0
  ? <div className={styles.empty}>暂无用户</div>
  : <div className={styles.list}>
      {displayedUsers.map(user => <div className={styles.user} key={user.id}>{user.name}</div>)}
    </div>
```

设计态交互脚本通过顶层属性赋值更新展示，例如 `window._proxy_.users = [{ id: '1', name: '张三' }];`。不要只修改数组或对象内部的数据。以上仅为写法示例，不表示所有页面都需要接入这些字段。

需要接入覆盖时，先完成相关 TSX 修改，再查看修改后的代码，确认组件实际展示位置及其最终行号，最后更新项目根目录下的 `.agent/proxy-mock/interactive-scripts.yaml`。不要预估修改前的行号。文件顶层是页面数组，每个页面项包含 `page` 和 `locations`；`page` 是页面 DOM 上 `data-desn-page` 的路径，例如 `/users`，`locations` 是该页面内按组件划分的分组数组。一个组件只建立一个分组；组件展示多个字段或多个状态时，把它们组合到同一组件的场景中，不要按字段再拆分分组。只维护需求涉及的页面及组件，保留其他页面和组件的记录。同一页面内已有相同组件的 `fileName` 与 `loc` 时，将场景合并到该项的 `scripts` 数组；组件位置因代码修改而变化时，更新对应记录的 `loc`：
- `title`：基于组件名和组件完整职责生成的中文名称，用作展示分组标题，不直接填写源码组件名。优先根据源码组件名理解组件范围；没有明确组件名时，使用能概括组件完整职责的中文名称。不要根据单个数据字段、状态名或条件分支命名；如果组件同时处理标题、筛选、加载、空状态和列表，标题应概括整个组件职责，而不是写成“列表”或某个状态名称；
- `fileName`：组件 JSX 所在的 TSX 文件路径，相对于项目根目录；
- `loc`：该组件在页面中负责展示状态的真实 JSX 标签位置，格式为 `标签名:起始行-结束行`，例如 `section:42-48`。行号以最终代码为准，不写状态变量或覆盖变量的声明位置；
- `scripts`：该组件的场景数组，每项包含 `title` 和 `script`。`title` 是执行后用户可看到的场景名称；`script` 是可独立执行的 JavaScript 字符串，用顶层属性赋值设置一个或多个 `window._proxy_` 属性。只记录需要主动设置覆盖值的场景；不要在返回的操作执行数组或 YAML 中添加「默认」「初始」「原始」「正常」「恢复默认」等表示未覆盖或恢复原状的操作，也不要为这些操作生成能力或 `script`。设计态已提供默认操作，无须重复记录。

同一页面包含多个组件时，分别记录组件和对应场景。一个组件的场景可以同时设置多个展示字段。例如 `/dashboard` 页面包含统计卡片和订单列表，统计卡片组件的 `loading` 来自父组件传入，父组件已在来源处接入覆盖；交互脚本仍按页面中的组件分组。页面级组件如果同时负责标题、筛选、加载态、空状态和内容展示，即使场景主要覆盖列表数据，分组标题也应使用概括页面整体职责的中文名称，不能只写某个局部列表或状态名称：

```yaml
- page: /dashboard
  locations:
    - title: 统计概览
      fileName: pages/Dashboard/index.tsx
      loc: "section:42-48"
      scripts:
        - title: 加载中
          script: |
            window._proxy_.statsLoading = true;
            window._proxy_.totalOrders = 0;
        - title: 无数据
          script: |
            window._proxy_.statsLoading = false;
            window._proxy_.totalOrders = 0;
    - title: 订单列表组件
      fileName: pages/Dashboard/index.tsx
      loc: "section:50-62"
      scripts:
        - title: 暂无订单
          script: window._proxy_.orders = []
```

示例中的路径、行号和字段名仅说明格式；实际记录必须匹配修改后的代码。不要为需求范围外的组件添加场景，也不要记录代码中不存在的场景。
