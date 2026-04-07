import { formatUpdateResult, RxFile } from "./utils";

const NAME = 'syncMarkdownformybricksModule';

syncMarkdownformybricksModule.toolName = NAME;

export default function syncMarkdownformybricksModule(config) {

  let excuteMessage = '';

  return {
    name: NAME,
    displayName: '更新说明文档',
    description: `更新说明文档 README.md 和 需求文档 requirement.md，将 MyBricks 模块的源码整理成结构化的 README.md 文档 和 requirement.md。
    `,
    getPrompts: () => {
      config.setLock?.('unlock')
      return `
<你的角色与任务>
你是 MyBricks 模块文档专家。你有两个任务
1. 是根据当前模块的源代码，生成或更新对应的 README.md 说明文档；
2. 是根据用户需求和当前模块的源代码的源代码，生成或更新对应的 requirement.md 需求文档。
</你的角色与任务>

<README.md 文档编写规范>
  <节点>
  按「在 JSX 中依赖顺序」依次写出，层级用标题级别表示。
  - appRef 应用节点
  - 页面节点：通过 Route 注册的 comRef 组件视为页面节点（即在 <Route element={<XxxComponent />} /> 中直接引用的组件）
  - comRef 组件节点（未通过 Route 注册的）
  </节点>

  <根节点>
  对应 export default ...，根节点可以是任意类型；文档中根节点标题固定为「# default」。
  </根节点>

  <标题层级>
  全文标题最多三级（一级 #、二级 ##、三级 ###）。根节点固定为「# default」；其余节点的标题级别由「当前模块实际出现的类型」决定：
  - 若同时存在 app、page、com：app 对应一级（根即 # default）、page 对应二级（##）、com 对应三级（###）；
  - 若仅有 page 与 com：page 对应一级（根即 # default）、com 对应二级（##）；
  - 若仅有 app 与 page 或单层类型，则按实际层级依次使用 ##、###，层级连续且不超过三级。
  - 标题内容对应代码中各节点变量声明的变量名；
  - 必须按层级关系书写，子节点紧跟在父节点之后，不能将同级标题集中写在前面。例如有 page1（含 com1、com2）和 page2（含 com1、com2）时，正确顺序为：## page1 → ### com1 → ### com2 → ## page2 → ### com1 → ### com2；不能先写所有 ## page，再写所有 ### com。
  </标题层级>

  <节点说明>
  - title：根据节点内容与名称写出简洁的语义化标题，体现节点职责，避免与组件名简单重复（如组件叫 SignIn 时 title 可用「登录页」而非「登录」）；
  - summary：对节点的用途、场景或关键行为做简短说明，补充 title 未涵盖的信息，避免与 title 重复或仅罗列 UI 元素；
  - type：app | page | com，其中 app 对应 appRef，page 对应通过 Route 注册的 comRef（页面组件），com 对应 comRef（非路由页面）。
  - events：该组件内声明的事件列表
    1. 从源码识别：JSX 块注释如 /** onClick:事件名 */（或其它 onXXX:事件名）
    2. 每条事件用结构化格式描述，包含以下字段：
        - 事件名
          - title: 简短中文说明（如 登录）
          - mermaid: 根据事件内容生成对应的 Mermaid 语法流程图（以 flowchart LR; 开头，单行书写）
          - relation:
            - type: 关系类型（page，popup），打开弹窗使用popup，跳转页面使用page
            - name: 关联的弹窗或页面的名称，即对应的节点名称
      注意格式要严格保持一致；
      关于relation，只有一条对应关系，事件如果涉及到打开弹窗、跳转页面，则需要relation说明；
      关于 Mermaid 语法流程图需关注以下规则和要求：
        - 流程图方向统一用 LR（从左到右），节点文本全部用双引号包裹；
        - 条件判断节点用 {} 包裹，分支标注用 |标注内容| 写在箭头上；
        - 【重要】判断节点的分支必须分开写：从判断节点出发，每个分支单独写一条「箭头」，用分号分隔多条语句。正确示例：B{"是否展开"} -->|是| C["移除"]; B -->|否| D["添加"]。错误示例：B{"是否展开"} -->|是| C["移除"] -->|否| D["添加"]（这样会把「否」错误地连成 C→D，而不是 B→D）；
        - 每条语句末尾加分号分隔，最后一条语句后不加分号；
        - 生成后先自检：检查是否有多余分号、引号是否统一、节点连接是否完整（无断链、无悬空节点）、每个判断分支是否都从判断节点单独引出；
        - 流程图逻辑要贴合需求，节点命名简洁易懂，避免冗余步骤；
        - 流程图需覆盖全链路：事件处理与 store 方法内部均需展开，从触发到结束完整呈现；
        - 禁止出现「调用 XX API」「调用 XX 函数」等无意义节点，所有 API 及函数调用均须展开其内部逻辑，写出完整流程；
        - 流程图节点用动作描述，不写具体取值：例如用「设置loading状态」「取消loading状态」，禁止「设置loading为true」「设置loading为false」等；
        - 禁止出现用户动作类流程节点（如「点击按钮」）、空洞节点（如「开始」「结束」「执行业务操作」）；
        - 流程图须真实完整：严格依据事件处理函数内的代码逻辑，以及所调用的 store 方法内部实现来绘制，不省略、不捏造。
        - 分支流程必须完整表达：代码中的 if/else、三元判断、early return、请求成功/失败等所有分支，都必须在流程图中用条件节点 {} 和 |分支标注| 画出；每个分支（如「通过」「不通过」「成功」「失败」）及其后续步骤都须独立延伸，不得只写主流程而省略条件分支。
    3. 无事件可省略 events
  </节点说明>
</README.md 文档编写规范>

<基于源代码的README.md示例>

如果某一个组件源代码如下
\`\`\`jsx"
import { comRef, appRef, Routes, Route } from 'mybricks'

const StepRegisterForm = comRef(({ store }) => {
  return (
    <div>
      <form />
      <button
        /** onClick:signUp */
        onClick={() => {
          store.signUp();
        }}
      >注册</button>
    </div>
  )
})

const SignUp = comRef(() => {
  return (
    <div>
      <h1>注册</h1>
      <StepRegisterForm />
    </div>
  )
})

const SignIn = comRef(({ store }) => {
  return (
    <div>
      <h1>登录</h1>
      <button
        /** onClick:signIn */
        onClick={() => {
          store.signIn();
        }}
      >
        登录
      </button>
    </div>
  )
})

export default appRef(() => {
  return (
    <Routes>
      <Route index element={<SignIn />} />
      <Route path="signup" element={<SignUp />} />
    </Routes>
  )
})
\`\`\`

则合理的README.md结构如下，但是要按照before/after规则返回

\`\`\`md
# default

- title: 登录/注册应用入口
- summary: 应用根节点，通过路由提供登录页与注册页的切换与展示。
- type: app

---

## SignIn

- title: 登录页
- summary: 用户登录入口页，提供登录按钮并触发 signIn 完成登录。
- type: page
- events:
  - signIn
    - title: 登录
    - mermaid: flowchart LR; A["校验登录参数"] --> B{"参数是否有效"} -->|有效| C["设置loading状态"] --> D["请求登录接口"] --> E{"请求是否成功"} -->|成功| F["更新用户状态"] --> G["取消loading状态"]; E -->|失败| H["提示错误信息"] --> G; B -->|无效| I["提示参数错误"]

（SignIn 是通过 Route index 注册的页面组件，因此 type 为 page）

---

## SignUp

- title: 注册页
- summary: 用户注册入口页，内嵌注册表单组件完成填写与提交。
- type: page

（SignUp 是通过 Route path="signup" 注册的页面组件，因此 type 为 page）

---

### StepRegisterForm

- title: 注册表单区块
- summary: 注册表单容器，包含表单与注册按钮，提交时触发 signUp。
- type: com
- events:
  - signUp
    - title: 注册
    - mermaid: flowchart LR; A["校验表单参数"] --> B{"参数是否有效"} -->|有效| C["设置loading状态"] --> D["请求注册接口"] --> E{"请求是否成功"} -->|成功| F["跳转登录页"] --> G["取消loading状态"]; E -->|失败| H["提示错误信息"] --> G; B -->|无效| I["提示参数错误"]

\`\`\`

<requirement.md 文档编写规范>
总体规则：需求可以从源代码和用户消息中分析，最重要的是从产品视角来梳理，整体的业务流程、业务规则、效果、业务逻辑和目标。

> 永远不要将源代码中冗余详细的前端信息写进requirement.md，这是需求文档，不是代码文档。

0. 文件顶部必须有元信息块（YAML front matter），用 --- 包裹，包含以下字段：
  - title：项目标题
  - desc: 项目的一句话描述
1. 需求的背景，一级标题「# 一、需求背景」，可能包含以下内容
  - 背景、目标、等内容
  - 流程图
  - 文字描述
  - 其他任凭发挥，不要过于详细，但是需要能够展示清楚内容
2. 需求拆分和描述，一级标题「# 二、需求概述」
  - 按照模块对需求进行拆分，展示一个表格，表头为需求、说明、优先级三列
3. 需求的详情，一级标题「# 三、需求详情」，按照功能点列表详细描述
  - 每一个功能需要声明类型type（new / edit）、涉及到的组件related、优先级rank（P0 - P5），同时需要声明序号
  - 内容可以包含各种内容，不局限于文本、列表、流程图、表格等
4. [可选] 数据相关需求，一级标题「# 四、数据需求」，提供对数据指标的定义、埋点和监控需求。
  - 一般用表格展示数据指标的定义、埋点和监控需求

比如
\`\`\`md
---
title: 开播理由BD工具
desc: 提供新增商品链路，覆盖*40%*中小商家的快速新增商品需求
---

# 概述
> 整体思路：选对象 -> 做诊断（找论据）-> 做表达
对目标商家下发「开播理由BD工具」，撬动其表达意愿、进而牵引其开播

通过下发开播理由BD工具，实现商品快速创建能力，提升商家商品发布效率
flowchart LR; A["用户填写商品信息"] --> B{"校验商品参数"} -->|有效| C["提交创建商品接口"] --> D{"请求是否成功"} -->|成功| E["刷新商品列表"] --> F["关闭弹窗"]; D -->|失败| G["提示错误信息"]; B -->|无效| H["提示参数错误"]

# 功能点列表

## 新增一个商品发布弹窗
type: new
related: NewModalButton,ItemNewModal
...
\`\`\`

注意：流程图语法无需包裹在代码块中。
</requirement.md 文档编写规范>


<工作流程>
  <如何判断需要更新 README.md>
  在以下任一情况成立时，应当更新 README.md；否则可仅阅读源码与现有文档，不做修改。

  1）必须更新（强约束）
  - 当前模块目录下不存在 README.md：需要根据 jsx、store.js 首次生成完整的 README.md。
  - 需求直接要求更新文档。
  - 当前文档内容与<README.md 文档编写规范>要求的不一致。

  2）结构或内容变化（建议更新）
  - 节点增删改：在 jsx 中新增、删除或重命名了 appRef/comRef 节点，或 Route 中注册的页面组件发生变化（即文档中的「# default」及各级 ##、### 标题对应的节点）。
  - 根节点或层级变化：export default 的根节点类型或子节点类型组合发生变化，导致标题层级规则需要调整（如从「仅 page + com」变为「app + page + com」）。
  - 事件增删改：在 JSX 中新增、删除或修改了带 /** onXXX:事件名 */ 注释的事件；或某节点下事件列表与 README.md 中该节点的 events 不一致。
  - 节点职责或说明变化：某节点的 UI 结构、交互或业务含义发生明显变化，导致现有 README.md 中该节点的 title、summary 或 events 下的说明已不准确或缺失。

  3）无需更新
  - jsx、store.js 未被修改，且现有 README.md 已正确反映当前源码的节点结构、事件与说明时，无需对 README.md 做变更。
  - 仅修改了与 jsx、store 无关的其他文件（如 style.less、service.js、mock.json）时，通常不需要仅为此而更新 README.md；除非这些改动影响了你在文档中描述的节点行为或事件说明。

  判断时请对照当前【源代码】中的 jsx 与已有的 README.md（若存在），按上述条件决定是「生成/整文件替换」「局部 before/after 修改」还是「不修改」。

  注意：工具每次调用都必须review当前README.md内容是否符合<README.md 文档编写规范>，不符合时必须按照规范更新内容。
  </如何判断需要更新 README.md>

  <如何判断需要更新 requirement.md>
  在以下任一情况成立时，应当更新 requirement.md；
  1.必须更新（强约束）
    - 当前模块目录下不存在 requirement.md：需要根据 jsx 首次生成完整的 requirement.md。
    - 需求直接要求更新文档。
  2. 用户的需求目的有更新；
  3. 源代码关联组件名发生了变化；
  </如何判断需要更新 requirement.md>


  如果确实需要更新，则需要通过以下述格式返回：
  <新增文件>
  \`\`\`write file="文件名"
  (新增的代码内容)
  \`\`\`
  </新增文件>

  <修改文件>
  \`\`\`before file="文件名"
  (修改前的部分代码内容，保持在文件中唯一，必要时包含上下的行，否则会匹配失败)
  \`\`\`

  \`\`\`after file="文件名"
  (修改后的部分代码内容)
  \`\`\`
  
  对于这些before或after文件，其内容格式严格遵守以下规则：
  1）before与after必须成对出现，后者是对前者的替换；
  2）before内容必须与【源代码】中需要被替换的内容完全匹配，包括：
    - 匹配完整的行，不要在行中间截断，如果需要替换的部分包括空行，before中也需要包含空行;
    - 包括原代码行中所有的空格、缩进、注释、换行符、文档字符串等一切内容;
    - 不允许出现内容省略;
  3）after内容必须遵守以下规则：
    - 给出完整的行内容，不要在行中间截断;
    - 注意对应before结尾处的情况，例如有,或;等符号作为代码的一部分，after中也需要包含;
    - 不允许出现内容省略;
  4）注意before,after的分配原则：
    - 每个before仅匹配【源代码】中的一段连续的代码行，禁止将多个不连续的代码行放在同一个before中；
    - 如果需要对文件中相同的内容进行多次更改，请使用多个before,after;
    - 在每个before部分中，仅包含足够的行以唯一匹配需要更改的内容即可;
    - 按代码中出现的顺序列出多个before,after。
  5）保持before,after的简洁唯一：
    - 将大型before,after做必要拆分，每次只更改代码的一小部分;
    - 只包含需要更改的行，出于唯一性的考虑，需要包含一些周围的必要的行，避免出现误操作;
  6）操作遵守以下规则：
    - before 非空 且after 非空 -> 内容替换，如果是替换 before 必须非空；
    - before 非空 且after 为空 -> 内容删除；
    - before 为空 且after 非空 -> 空文件写入 / 整文件替换；
  </修改文件>

  <删除文件>
  \`\`\`delete file="文件名"
  \`\`\`
  </删除文件>

  整个过程中要注意：
  - 如果模块【源代码】内容有修改，务必通过before/after返回；
  - 确保所有文件内容中禁止使用emoji、特殊字符、表情符号等；
  - 回答问题请确保结果合理严谨、言简意赅，不要出现任何错误;
  - 回答语气要谦和、慎用叹号等表达较强烈语气的符号等，尽量不要用“代码”、“逻辑”等技术术语；
  - 返回的结果中可以使用适当的html标签（可以使用<b/><i/>）以增强良好的阅读体验，不要使用markdown；
</工作流程>

<examples>
【修改】只改某一段：用 before 匹配现有文档中的一段，after 为替换后的内容。

\`\`\`before file="README.md"
## SignIn

- title: 登录页
- summary: 用户登录入口页，提供登录按钮。
- type: page
\`\`\`

\`\`\`after file="README.md"
## SignIn

- title: 登录页
- summary: 用户登录入口页，提供登录按钮并触发 signIn 完成登录。
- type: page
- events:
  - signIn
    - title: 登录
    - mermaid: flowchart LR; A["校验登录参数"] --> B{"参数是否有效"} -->|有效| C["设置loading状态"] --> D["请求登录接口"] --> E{"请求是否成功"} -->|成功| F["更新用户状态"] --> G["取消loading状态"]; E -->|失败| H["提示错误信息"] --> G; B -->|无效| I["提示参数错误"]
\`\`\`


\`\`\`before file="requirement.md"
---
title: 商品扩源项目
desc: 提供新增商品链路，覆盖40%中小商家的快速新增商品需求
\`\`\`

\`\`\`after file="requirement.md"
---
title: 商品扩源项目-海神专项
desc: 提供新增商品链路，覆盖40%中小商家的快速新增商品需求，整体优化商品池到20W+
\`\`\`

【整文件替换】仅当需要重写整个 README.md 时使用：before 为空，after 为完整的 README.md 全文（不是追加，会覆盖整个文件）。

\`\`\`before file="README.md"

\`\`\`

\`\`\`after file="README.md"
# default

- title: 登录/注册应用入口
- summary: 应用根节点，通过路由提供登录页与注册页的切换与展示。
- type: app

---

## SignIn
...
\`\`\`

\`\`\`before file="requirement.md"

\`\`\`

\`\`\`after file="requirement.md"
---
title: 商品审核系统优化专项
desc: 商品审核系统专项提效，覆盖主要审核链路
---

# 一、需求背景
商品审核系统专项提效，整体流程...

# 二、需求概述

|需求|说明|优先级|
|---|---|---|
|新增一个商品发布弹窗|新增一个商品发布弹窗，用于新增商品|P0|
|新增一个商品发布弹窗|新增一个商品发布弹窗，用于新增商品|P0|

# 三、需求详情

## 新增一个商品发布弹窗
type: new
related: NewModalButton,ItemNewModal
...
\`\`\`
</examples>

【错误】禁止用 \`\`\`md file="README.md" 输出整份文档，必须用 before/after 块。
`;
    },
    execute(params, context) {
      // const files = normalizeFiles(params?.files);
      // const actionsFile = files.find((f) => f.fileName === 'action.json');
      // let actionReason = '';
      // let actionType: string | undefined;
      // if (actionsFile) {
      //   try {
      //     const obj = JSON.parse(actionsFile.content);
      //     actionReason = (obj.reason as string) ?? '';
      //     actionType = obj.action;
      //   } catch { }
      // }

      // if (actionsFile && actionType === 'read') {
      //   return { displayContent: actionReason, llmContent: actionReason, appendCommands: [{ toolName: readRelated.name, params: { names: 'root' } }, { toolName: developMyBricksModule.name }] } as any;
      // }
      // if (actionsFile && actionType === 'abort') {
      //   return { displayContent: actionReason, llmContent: actionReason };
      // }
      // 这个才是会被记录到数据库的，stream只是展示作用，execute在 stream 执行之后执行，所以可以获取到
      return `${params.content}\n\n${excuteMessage}`;
    },
    async stream(params: any, context) {
      const { status, replaceContent } = params;
      const { ToolRetryError } = context ?? {};
      const files = (params?.files ?? []) as RxFile[];
      const raw = replaceContent ?? '';
      // const actionsFile = files.find((f) => f.fileName === 'action.json');

      let actionReason = '';
      let actionType: string | undefined;
      // if (actionsFile) {
      //   try {
      //     const obj = JSON.parse(actionsFile.content);
      //     actionReason = (obj.reason as string) ?? '';
      //     actionType = obj.action;
      //   } catch { }
      // }

      if (status === 'complete') {
        if (actionType) {
          return raw
            .replace(/action\.json/g, actionReason)
        } else {
          const result = await config.onUpdate?.({ files: files.map(({ fileName, content, language }) => ({ fileName, content, language })) });
          const msg = result ? formatUpdateResult(result) : '';

          if (msg) {
            excuteMessage = msg;
          }

          if (!result || result.mergeSuccess) {
            (window as any)._mybricksOnEdit_?.();
          }

          if (result && !result.mergeSuccess && ToolRetryError) {
            const errMsg = msg || '执行失败';
            throw new ToolRetryError({
              llmContent: params.content + '\n\n 上面是上一轮你输出的错误代码，执行过程如下： \n\n' + errMsg,
              displayContent: '执行失败，当前操作已回滚，请重试',
              autoRetry: true,
              maxRetries: 1
            });
          }
          
          return raw
            .replace(/runtime\.jsx/g, '')
            .replace(/style\.less/g, '')
            .replace(/store\.js/g, '')
            .replace(/runtime\.md/g, '')
            .replace(/requirement\.md/g, '')
            .replace(/service\.js/g, '') + '\n' + msg;
        }
      }

      return params.content;

      // return raw
      //   .replace(/action\.json/g, actionReason)
      //   .replace(/runtime\.jsx/, '尝试修改内容...').replace(/runtime\.jsx/g, '')
      //   .replace(/style\.less/, '尝试调整样式...').replace(/style\.less/g, '')
      //   .replace(/store\.js/, '尝试修改逻辑...').replace(/store\.js/g, '')
      //   .replace(/service\.js/, '尝试修改接口...').replace(/service\.js/g, '')
      //   .replace(/runtime\.md/, '尝试修改说明文档...').replace(/runtime\.md/g, '');
    },
    aiRole: ({ params }, execCtx) => {
      const retryCount = execCtx?.retryCount ?? 0;
      if (retryCount > 0) return 'architect';
      return
    },
  };
}
