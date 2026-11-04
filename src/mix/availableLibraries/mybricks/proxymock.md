### 画布展示状态覆盖与交互脚本
项目设计态提供全局响应式对象 `window.__LINGSTYLE_DISPLAY_MOCK__`，用于临时覆盖列表、加载状态、错误状态、文案等 UI 展示数据。组件读取时必须使用可选链 `window.__LINGSTYLE_DISPLAY_MOCK__?.xxx`，因为该对象可能不存在；在渲染中读取后，对其顶层属性重新赋值可触发 UI 更新。

覆盖只影响画布显示，不改变正式数据源、请求、状态更新或其他业务流程；未设置覆盖值时沿用原有展示逻辑。React 状态或自定义 Hook 的展示值可以作为候选。若展示值由 props 传入，应沿调用链找到状态、Hook 返回值或请求结果等来源，在来源的展示值选择处接入覆盖。具体接入哪些数据由任务决定。

覆盖字段优先对应原有状态或数据源的完整值，不按 JSX 中读取的属性拆分。同一对象的多个展示属性来自同一个状态时，只接入一个对象覆盖字段，让这些展示位置共用该展示对象。例如某个对象状态 `object` 的多个属性用于展示时，先整体选择展示对象：

```tsx
// 设计态展示覆盖开始：优先展示整个对象的模拟值，未设置时使用原对象。
const displayedObject =
  window.__LINGSTYLE_DISPLAY_MOCK__?.object !== undefined
    ? window.__LINGSTYLE_DISPLAY_MOCK__?.object
    : object
// 设计态展示覆盖结束
```

场景脚本一次赋值 `window.__LINGSTYLE_DISPLAY_MOCK__.object = { title: '标题', description: '描述' };`，不要按属性分别创建 `objectTitle`、`objectDescription` 等字段。`object` 仅为示例占位名，实际覆盖字段应对应源码中的状态或数据源名称。仅当属性原本来自不同的独立状态或数据源时，才使用多个覆盖字段。

画布包括独立渲染的页面，以及通过 `popupRef` 包裹并独立渲染的弹窗、抽屉等浮层组件。创建画布状态时，只分析目标画布内的组件，不扩展到其他画布；页面中引用的 `popupRef` 浮层属于独立画布，不因调用关系自动纳入页面任务，浮层中的普通子组件仍归属于该浮层画布。选区或其他需求按指定节点和需求描述确定范围。只为有意义的可变化展示数据接入覆盖，不要求覆盖所有 Hook 返回值。交互脚本按实际负责渲染的 React 组件定义归组；即使在上层接入 props 来源，仍归入展示状态的子组件。

交互脚本以画布标识确定归属，统一使用以下规则：

- 页面画布：`page:${filename}:${widgetName}`；
- 浮层画布：`popup:${filename}:${widgetName}`。

`filename` 是画布根组件定义所在文件的完整路径，不截短为相对路径；`widgetName` 根据该根组件的源码定义确定：

- 包装调用赋值给变量时，使用声明的变量名。例如 `const EditUser = popupRef(...)` 或 `export const EditUser = popupRef(...)`，组件名均为 `EditUser`；`export default EditUser` 不改变该名称。
- 直接默认导出包装调用时，例如 `export default popupRef(...)`，使用文件名去掉扩展名后的名称；若文件名为 `index`，则使用直接父目录名。例如 `/project/components/EditUser.tsx` 和 `/project/components/EditUser/index.tsx` 均使用 `EditUser`。名称保留原有大小写。

不要使用中文标题、调用处的导入别名、JSX 行号或路由代替组件名。同一组件定义被多个路由或页面引用时，沿用同一个画布标识；普通子组件不单独生成画布标识。

需要编写交互脚本时，优先原样使用任务上下文或画布容器提供的当前画布标识。若未提供，须根据源码中的画布根组件定义及上述命名规则确认类型、完整文件路径及组件名，再按上述规则生成；仍无法确认时，不要填写或改动 YAML，并说明原因。不得使用占位标识，也不能借用或改写 YAML 中其他画布的标识。画布标识只决定记录归属，不扩大选区任务的处理范围。

以 `window.__LINGSTYLE_DISPLAY_MOCK__?.xxx !== undefined` 判断是否启用覆盖；`false`、`0`、`''`、`[]`、`null` 都可能是有效覆盖值。在组件渲染过程中直接读取属性，不解构、缓存或重新赋值 `window.__LINGSTYLE_DISPLAY_MOCK__`。覆盖值只用于展示，原有数据获取、事件处理和派生计算继续使用原值。

在 TSX 中接入展示覆盖时，用符合代码上下文的注释标明覆盖代码的开始和结束，并在开始注释中概括这段代码覆盖的展示值及未设置时的回退值。同一组件内连续的多条 `__LINGSTYLE_DISPLAY_MOCK__` 覆盖声明只用一组注释：开始注释放在第一条覆盖声明之前，结束注释放在最后一条覆盖声明之后；即使覆盖不同字段，也不要给每条声明分别加一组注释。只有覆盖代码被原有业务代码隔开时，才分别包裹各段。下方统计组件的加载状态和总数覆盖共用一组注释。

示例：子组件通过 props 展示统计数据，在父组件的来源处选择展示值；场景仍归入统计组件。

```tsx
const Stats = ({ loading, total }) => (
  <section>{loading ? '加载中' : `${total} 个`}</section>
)

const Dashboard = () => {
  const { loading: originalLoading, total } = useStats()
  // 设计态展示覆盖开始：替换统计组件的加载状态和总数，未设置时使用 Hook 返回值。
  const loading =
    window.__LINGSTYLE_DISPLAY_MOCK__?.statsLoading !== undefined
      ? window.__LINGSTYLE_DISPLAY_MOCK__?.statsLoading
      : originalLoading
  const displayedTotal =
    window.__LINGSTYLE_DISPLAY_MOCK__?.totalOrders !== undefined
      ? window.__LINGSTYLE_DISPLAY_MOCK__?.totalOrders
      : total
  // 设计态展示覆盖结束

  return <Stats loading={loading} total={displayedTotal} />
}
```

示例：列表经过筛选等计算，或原变量还参与业务逻辑时，保留原值及计算过程，另定义展示变量；列表内容和空状态判断使用同一个展示变量。

```tsx
const filteredUsers = useMemo(
  () => users.filter(user => user.name.includes(keyword)),
  [users, keyword]
)
// 设计态展示覆盖开始：替换筛选后的展示列表，未设置时使用原筛选结果。
const displayedUsers =
  window.__LINGSTYLE_DISPLAY_MOCK__?.users !== undefined
    ? window.__LINGSTYLE_DISPLAY_MOCK__?.users
    : filteredUsers
// 设计态展示覆盖结束

return displayedUsers.length === 0
  ? <div className={styles.empty}>暂无用户</div>
  : <div className={styles.list}>
      {displayedUsers.map(user => <div className={styles.user} key={user.id}>{user.name}</div>)}
    </div>
```

设计态交互脚本通过顶层属性赋值更新展示，例如 `window.__LINGSTYLE_DISPLAY_MOCK__.users = [{ id: '1', name: '张三' }];`。不要只修改数组或对象内部的数据。以上仅为写法示例，不表示所有画布都需要接入这些字段。

需要接入覆盖时，先完成 TSX 修改，再查看最终代码，确认组件展示位置和行号，最后更新项目根目录下的 `.agent/display-mock/interactive-scripts.yaml`。文件顶层是画布数组；每项的 `canvas` 是当前画布标识，`components` 按实际负责渲染的 React 组件定义分组。同一组件在该画布只建一个分组，组件内的多个状态、JSX 区域和条件渲染分支都放进这一项的 `scripts`；内部的 `div`、弹层或提示条若没有独立的 React 组件定义，不得另建分组。`loc` 取能代表该组件完整展示职责的 JSX 标签，而不是某个状态的局部标签。

更新前先读取 YAML，按当前画布标识精确匹配 `canvas`：已有则只更新需求涉及的组件，没有则新增画布项。禁止把其他画布项改名或作为模板覆盖；写入后核对所有非目标画布的标识、组件和场景均未改变。对目标画布，依据组件名、文件和展示 JSX 识别已有分组，合并场景并将 `loc` 更新为最终位置；不能仅因行号变化就新增重复分组。

- `title`：用简短、易懂的中文概括组件呈现的内容或功能，优先沿用画布或区域已有的名称；没有现成名称时，根据组件职责命名。标题无需罗列加载、空数据等具体场景，也应避免添加「状态」「展示」等不能帮助用户识别区域的泛称；场景细节由 `scripts` 的标题表达。
- `fileName`：组件 JSX 所在的 TSX 文件路径，相对于项目根目录；
- `loc`：该组件在画布中负责展示状态的真实 JSX 标签位置，格式为 `标签名:起始行-结束行`，例如 `section:42-48`。行号以最终代码为准，不写状态变量或覆盖变量的声明位置；
- `scripts`：场景数组，每项含可见场景名称 `title` 和可独立执行的 JavaScript `script`；脚本通过顶层属性赋值设置一个或多个 `window.__LINGSTYLE_DISPLAY_MOCK__` 字段。以未设置覆盖值时的展示为基准，只记录呈现不同可见状态的场景。例如状态默认是 `false`，单独设为 `false` 不构成场景；组合场景可以包含该赋值，但整体须因其他覆盖值而呈现不同状态。设计态已有默认操作，不添加「默认」「初始」「原始」「正常」「恢复默认」等场景。

若用户需求明确指定了需要哪些状态，只为这些状态生成场景脚本，不根据下方建议自行增加其他状态。未明确指定时，选择场景可以参考以下方向，并结合当前组件的展示数据和分支判断是否适用：

- 文本：可用较长内容观察换行、截断和布局；
- 数组：默认有内容时可用空数组检查空态，默认为空时可考虑有内容的列表；
- 数字：可考虑 `0` 或较大值；
- 布尔值、枚举值及加载、错误等状态：可选择与默认展示不同的有效取值。
- 其它

这些只是候选方向，无需为每种类型都生成脚本。优先考虑当前代码支持、与任务相关且能带来可见差异的场景；对象和数组的模拟值尽量沿用原有数据结构，避免为了补充场景而加入无关的覆盖字段或展示分支。

示例：假设页面画布根组件为 `Dashboard`，定义所在文件的完整路径为 `/project/pages/Dashboard/index.tsx`，其统计组件默认总数非零、未加载。统计数据在父组件接入覆盖，统计组件的加载和无数据状态仍属于同一个分组；「无数据」组合场景中的 `statsLoading = false` 用于明确该场景的状态，变化来自 `totalOrders = 0`：

```yaml
- canvas: page:/project/pages/Dashboard/index.tsx:Dashboard
  components:
    - title: 统计概览
      fileName: pages/Dashboard/index.tsx
      loc: "section:42-48"
      scripts:
        - title: 加载中
          script: window.__LINGSTYLE_DISPLAY_MOCK__.statsLoading = true;
        - title: 无数据
          script: |
            window.__LINGSTYLE_DISPLAY_MOCK__.statsLoading = false;
            window.__LINGSTYLE_DISPLAY_MOCK__.totalOrders = 0;
```

浮层画布使用同样的组件分组结构，例如组件 `EditUser` 通过 `popupRef` 包裹，定义所在文件的完整路径为 `/project/components/EditUser.tsx`：

```yaml
- canvas: popup:/project/components/EditUser.tsx:EditUser
  components:
    - title: 用户信息
      fileName: components/EditUser.tsx
      loc: "form:25-60"
      scripts:
        - title: 保存中
          script: window.__LINGSTYLE_DISPLAY_MOCK__.saving = true;
```

`canvas` 中的 `filename` 使用画布根组件的完整文件路径，`components` 中的 `fileName` 仍使用各展示组件相对于项目根目录的文件路径，两者用途不同。

示例路径、组件名、行号和字段名仅说明格式；实际记录须匹配最终代码，不添加需求范围外或代码中不存在的场景。
