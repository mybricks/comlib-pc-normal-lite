# local-iframe 模式改造分析

## 结论

建议为 `local-iframe` 建立独立的运行容器和编辑适配层，但不建议复制一套完整编辑器。

这次改动已经不只是为现有逻辑增加一个条件分支。`local-iframe` 同时改变了预览容器、源码事实来源、文件持久化方式、热更新时序和撤销重做模型。继续在现有编辑器中分散插入 `config.getFrontendMode() === 'local-iframe'` 分支，会使两种模式的行为和状态越来越难以推断。

## 模式差异

| 领域 | 原 web 内存模式 | `local-iframe` 模式 |
| --- | --- | --- |
| 预览运行方式 | 当前组件 Runtime 直接渲染 | 独立 iframe 加载本地工程启动的服务 |
| 预览 DOM | 当前设计器 ShadowRoot | iframe 的 `contentDocument` |
| 源码事实来源 | `context.component.params.data.files` | 本地工程文件系统 |
| 文件修改 | `context.updateFile` 更新内存、编译结果和画布 | 通过本地服务接口写磁盘，再由 HMR 更新 iframe |
| 文本和删除 | 同步改内存源码及当前 DOM | 按 JSX 偏移调用本地服务接口，并维护 DOM 偏移 |
| 样式写回 | 解析 Less 或 patch JSX 后重写内存源码 | CSSOM 乐观预览，再由服务端按选择器或 JSX 范围写回 |
| 撤销重做 | 同步内存快照 | 服务端返回文件快照，异步恢复本地文件 |
| AI 桥接 | 完整 sandbox、文件系统、history、hooks、chips | 新增 local sandbox，但当前仍为接口骨架 |

## 当前实现涉及的主要链路

1. 运行入口：`runtime.edit.tsx` 在 local 模式直接渲染 iframe，不再挂载原来的 `Runtime`。
2. 模式判定：`config.getFrontendMode()` 通过 `window.MYBRICKS_LOCAL_IFRAME` 返回 `local-iframe`。
3. AI 桥接：新增 `sandbox/forLocalIframe.ts`，尝试向 `connectToAI` 注册本地模式 Designer。
4. 文本与删除：`setSegment/updateText.ts`、`setSegment/delete.ts` 调用本地文件接口，首次修改后再登记分支命令。
5. 样式：`createSetStyleHandler.ts` 与 `styleProxy.ts` 分别增加 local CSSOM 预览、本地 Less/JSX 写回和恢复逻辑。
6. 热更新：文件写入后的预览刷新依赖本地服务和 iframe 内工程的 HMR；当前前端没有显式的 HMR ready/ack 协议。

## 主要风险

### 1. local sandbox 尚未完成闭环

`src/mix/sandbox/forLocalIframe.ts` 中的 `getFiles`、`verify`、`updateFiles`、`deleteFiles`、`exportResourceCode`、日志和运行时状态接口大多返回空值或仅输出日志。AI 无法可靠读取、修改和持久化本地工程，也没有完成版本、loading、chips 和轮次收尾逻辑。

原 `sandbox/index.ts` 已经具备成熟的按组件注册、文件快照、history、AI 生命周期处理；local 版本目前是复制后的裁剪骨架，两者会持续分叉。

### 2. iframe 注册和生命周期不可靠

`forLocalIframe.ts` 使用模块级 `registerSuccess`。它在检查 `connectToAI` 是否可用之前就被设为 `true`，并且不按 `comId` 隔离：

- sandbox 尚未就绪时会永久跳过后续注册；
- 多个组件或重挂载场景只能注册第一个组件；
- 没有 dispose 和失败重试；
- local 模式没有沿用原模式的“注册完成后再渲染”时序。

同时，iframe id 和 URL 当前硬编码在 `runtime.edit.tsx`，不支持多工程、多页面或配置化入口。

### 3. HMR 与撤销重做存在竞态

文本和删除路径会先请求本地服务，成功后直接操作当前 iframe DOM；undo/redo 里的后续文件请求是 fire-and-forget。样式路径也会在请求成功后才登记分支命令。

本地工程 HMR 可能在任意时刻替换 iframe 内 DOM，导致以下问题：

- `fromEle`、父节点和兄弟节点引用失效；
- 已手动修正的 `data-loc`、`data-zone-text-editable`、`data-style-info` 被新 DOM 覆盖；
- 多次 apply、undo、redo 的请求和 HMR 到达顺序无法保证；
- 请求失败只记录控制台日志，画布预览、操作面板和磁盘内容可能不一致。

`localStyleUpdate.ts` 仅串行化 restore 请求，没有将 apply、restore 和 HMR 确认放进同一文件级队列，因此无法保证最终落盘状态。

### 4. 本地模式仍混用内存文件模型

local 文本和删除逻辑明确假设源码不在组件 `data.files` 中，但 `styleProxy.ts` 仍从 `context.component.params.data.files`、`styleSource` 读取 Less 和 JSX 源码，用于决定 inline-style、Less 和删除路径。

如果 local 模式没有完整维护镜像 `data.files`，这些路径会出现空数据、无法找到 JSX 文件，或者直接访问 `aiComParams.data` 失败。即使当前本地服务同步了部分文件，仍然会形成两个可能不一致的源码事实来源。

### 5. 本地文件协议分散在多个编辑器中

文本、删除和样式分别维护 endpoint、payload、错误处理、缓存和恢复策略：

- `/__lingchuang-local-file/text`
- `/__lingchuang-local-file/delete`
- `/__lingchuang-local-file/style`

这使协议字段、并发控制、权限校验、错误反馈和 HMR 确认难以统一演进。

### 6. 样式逻辑重复且与跨窗口 DOM 强耦合

`styleProxy.ts` 与 `createSetStyleHandler.ts` 都实现了 iframe CSSOM 规则识别、特指度排序、规则选择和预览恢复。跨 window 的 CSSOM 使用 `constructor.name === 'CSSStyleRule'` 判断，且依赖手工生成的 style id。

这类逻辑应集中在 iframe 预览适配器中。否则新增媒体查询、嵌套规则、动态样式表或 iframe 重载时，两条路径很容易产生不一致。

### 7. 原模式存在回归面

`editors/index.tsx` 重新启用了 `resizer()`，其影响范围是所有模式，而不是仅 local 模式。`tsconfig.json` 的 `moduleResolution` 也从 `bundler` 改为 `node`，这是全局构建行为变化，需要独立证明必要性和回归测试。

## 建议的拆分结构

```text
RuntimeEdit
|- WebRuntimeHost
`- LocalIframeHost
   |- LocalIframePreview
   |  |- iframe URL、load、ready、reload、dispose
   |  `- iframe Document 和 HMR 确认
   |- LocalProjectBridge
   |  |- connectToAI
   |  |- Designer FS
   |  |- hooks、history、版本和 loading
   |  `- 本地工程权限与错误反馈
   `- LocalFileGateway
      |- text/delete/style/source 写入
      |- 文件 revision 与 expectedContent
      |- 文件级串行队列
      `- apply/restore/HMR ack

Shared Editors
`- 编辑意图 -> EditCommand
   |- WebProjectAdapter
   `- LocalIframeProjectAdapter
```

建议新增的不是一个包含全部逻辑的大组件，而是以下三个边界清晰的模块：

1. `LocalIframeHost` React 组件：只处理 iframe 的创建、配置、加载、卸载和预览状态。
2. `LocalFileGateway`：本地文件接口的唯一入口，统一处理 revision、串行队列、恢复和错误。
3. `LocalIframeProjectAdapter`：把通用的文本、删除、样式编辑意图翻译成 local 文件操作与 iframe 预览操作。

现有编辑器应保留为共享层，只依赖抽象能力，例如：`getPreviewDocument`、`replaceText`、`deleteElement`、`updateStyle`、`restoreFiles`、`waitForPreviewRevision`。原 web 模式和 local 模式分别提供实现，避免业务逻辑反复判断 frontend mode。

## 推荐推进顺序

1. 定义本地文件协议：每个修改返回文件快照、revision 和 HMR 完成标识；所有写入支持 expectedContent 或 revision 校验。
2. 完成本地 Designer FS：实现读取、更新、删除、校验、AI 生命周期和按 `comId` 注册管理。
3. 提取 `LocalFileGateway`：移除文本、删除、样式模块中重复的 fetch、恢复队列和错误处理。
4. 提取 `LocalIframeHost`：移除硬编码 URL/id，提供 iframe ready、reload、dispose 和 HMR ack。
5. 将 undo/redo 改为可等待的异步命令，或保证所有操作进入同一文件级队列后再更新分支状态。
6. 将 `styleProxy` 和 `createSetStyleHandler` 中的 local CSSOM 逻辑收敛到同一个预览适配器。
7. 增加端到端覆盖：文本、删除、Less、JSX inline style、连续操作、undo/redo、HMR 重载、服务端冲突和外部文件修改。

## 验证情况

- 已检查暂存区变更，共 11 个文件，约 1,257 行新增、49 行删除。
- `git diff --cached --check` 发现两处尾随空格：`runtime.edit.tsx` 与 `forLocalIframe.ts`。
- 项目未安装本地 TypeScript 编译器；尝试通过 `npx tsc --noEmit` 验证时因受限网络无法下载 `tsc`，未能完成类型检查。
