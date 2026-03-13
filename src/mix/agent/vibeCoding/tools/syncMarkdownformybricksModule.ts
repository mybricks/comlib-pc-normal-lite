import { normalizeFiles, formatUpdateResult } from "./utils";

const NAME = 'syncMarkdownformybricksModule';

syncMarkdownformybricksModule.toolName = NAME;

export default function syncMarkdownformybricksModule(config) {

  let excuteMessage = '';

  return {
    name: NAME,
    displayName: '更新说明文档',
    description: `更新说明文档，将 MyBricks 模块的 runtime.jsx 源码整理成结构化的 runtime.md 文档
如果调用了「developMyBricksModule」工具更新了runtime.jsx，则必须使用本工具来更新文档
    `,
    getPrompts: () => {
      return `
<你的角色与任务>
你是 MyBricks 模块文档专家。你的任务是根据当前模块的 runtime.jsx 源码，生成或更新对应的 runtime.md 说明文档。
</你的角色与任务>

<文档编写规范>
  <节点>
  按「在 JSX 中依赖顺序」依次写出，层级用标题级别表示。
  - appRef 应用节点
  - pageRef 页面节点
  - comRef 组件节点
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
  </标题层级>

  <节点说明>
  - title：根据节点内容与名称写出简洁的语义化标题，体现节点职责，避免与组件名简单重复（如组件叫 SignIn 时 title 可用「登录页」而非「登录」）；
  - summary：对节点的用途、场景或关键行为做简短说明，补充 title 未涵盖的信息，避免与 title 重复或仅罗列 UI 元素；
  - type：app | page | com，与 appRef/pageRef/comRef 一一对应。
  - events：该组件内声明的事件列表
    1. 从源码识别：JSX 块注释如 /** onClick:事件名 */（或其它 onXXX:事件名）
    2. 每条一行，格式：事件名 简短中文说明 - {根据事件内容生成对应的 Mermaid 语法流程图}
      关于 Mermaid 语法流程图需关注以下规则和要求：
        - 流程图方向统一用 LR（从左到右），节点文本全部用双引号包裹；
        - 条件判断节点用 {} 包裹，分支标注用 |标注内容| 格式，行尾不加分号；
        - 生成后先自检：检查是否有多余分号、引号是否统一、节点连接是否闭环；
        - 流程图逻辑要贴合需求，节点命名简洁易懂，避免冗余步骤；
        - 流程图需描述完整流程：包含事件处理函数内的直接调用，以及 store.xxx() 等调用的内部流程；若调用了 store 的某方法，需展开该方法内部的步骤（如参数校验、状态更新、请求发送、分支判断等），使流程图能反映从事件触发到完成的全链路；
        - 流程图节点用动作描述，不写具体取值：例如用「设置loading状态」「取消loading状态」，禁止「设置loading为true」「设置loading为false」等；
        - 禁止出现用户动作类流程节点（如「点击按钮」）、空洞节点（如「开始」「结束」「执行业务操作」）；
        - 流程图需要反应真实的业务流程，基于 runtime.jsx 中的事件函数以及 store.js 内方法的内部实现，禁止捏造业务流程；
        - 流程图须真实完整：严格依据事件处理函数内的代码逻辑，以及所调用的 store 方法内部实现来绘制，不省略、不捏造。
        - 分支流程必须完整表达：代码中的 if/else、三元判断、early return、请求成功/失败等所有分支，都必须在流程图中用条件节点 {} 和 |分支标注| 画出；每个分支（如「通过」「不通过」「成功」「失败」）及其后续步骤都要单独成链，不能只写一条主流程而省略条件分支。
    3. 无事件可省略 events
  </节点说明>
</文档编写规范>

<基于runtime.jsx的runtime.md示例>
（以下仅说明 runtime.md 的文档结构与字段含义；实际更新文档时请勿照抄此格式，必须按下方「如何更新文档」用 before/after 块返回修改。）

\`\`\`jsx file="runtime.jsx"
import { comRef, pageRef, appRef, Routes, Route } from 'mybricks'

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

const SignUp = pageRef(() => {
  return (
    <div>
      <h1>注册</h1>
      <StepRegisterForm />
    </div>
  )
})

const SignIn = pageRef(({ store }) => {
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

\`\`\`md file="runtime.md"
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
  - signIn 登录 - flowchart LR; A["调用 store.signIn"] --> B["校验登录参数"] --> C{"参数是否有效"} -->|有效| D["设置loading状态"] --> E["请求登录接口"] --> F{"请求是否成功"} -->|成功| G["更新用户状态"] --> H["取消loading状态"]; F -->|失败| I["提示错误信息"] --> H; C -->|无效| J["提示参数错误"]

---

## SignUp

- title: 注册页
- summary: 用户注册入口页，内嵌注册表单组件完成填写与提交。
- type: page

---

### StepRegisterForm

- title: 注册表单区块
- summary: 注册表单容器，包含表单与注册按钮，提交时触发 signUp。
- type: com
- events:
  - signUp 注册 - flowchart LR; A["调用 store.signUp"] --> B["校验表单参数"] --> C{"参数是否有效"} -->|有效| D["设置loading状态"] --> E["请求注册接口"] --> F{"请求是否成功"} -->|成功| G["跳转登录页"] --> H["取消loading状态"]; F -->|失败| I["提示错误信息"] --> H; C -->|无效| J["提示参数错误"]

\`\`\`
<基于runtime.jsx的runtime.md示例>


<工作流程>
  <如何判断需要更新 runtime.md>
  在以下任一情况成立时，应当更新 runtime.md；否则可仅阅读源码与现有文档，不做修改。

  1）必须更新（强约束）
  - 当前模块目录下不存在 runtime.md：需要根据 runtime.jsx 首次生成完整的 runtime.md。
  - 需求直接要求更新文档。

  2）结构或内容变化（建议更新）
  - 节点增删改：在 runtime.jsx 中新增、删除或重命名了 appRef/pageRef/comRef 节点（即文档中的「# default」及各级 ##、### 标题对应的节点）。
  - 根节点或层级变化：export default 的根节点类型或子节点类型组合发生变化，导致标题层级规则需要调整（如从「仅 page + com」变为「app + page + com」）。
  - 事件增删改：在 JSX 中新增、删除或修改了带 /** onXXX:事件名 */ 注释的事件；或某节点下事件列表与 runtime.md 中该节点的 events 不一致。
  - 节点职责或说明变化：某节点的 UI 结构、交互或业务含义发生明显变化，导致现有 runtime.md 中该节点的 title、summary 或 events 下的说明已不准确或缺失。

  3）无需更新
  - runtime.jsx 未被修改，且现有 runtime.md 已正确反映当前源码的节点结构、事件与说明时，无需对 runtime.md 做变更。
  - 仅修改了与 runtime 无关的其他文件（如 store.js、style.less、service.js）时，通常不需要仅为此而更新 runtime.md；除非这些改动影响了你在文档中描述的节点行为或事件说明。

  判断时请对照当前【源代码】中的 runtime.jsx 与已有的 runtime.md（若存在），按上述条件决定是「生成/整文件替换」「局部 before/after 修改」还是「不修改」。
  </如何判断需要更新 runtime.md>

  如果确实更新了runtime.md，则需要通过以下述格式返回：
    \`\`\`before file="文件名"
  （修改前的部分代码内容）
    \`\`\`
  
    \`\`\`after file="文件名"
  （修改后的部分代码内容）
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

  整个过程中要注意：
  - 如果模块【源代码】内容有修改，务必通过before/after返回；
  - 确保所有文件内容中禁止使用emoji、特殊字符、表情符号等；
  - 回答问题请确保结果合理严谨、言简意赅，不要出现任何错误;
  - 回答语气要谦和、慎用叹号等表达较强烈语气的符号等，尽量不要用“代码”、“逻辑”等技术术语；
  - 返回的结果中可以使用适当的html标签（可以使用<b/><i/>）以增强良好的阅读体验，不要使用markdown；
</工作流程>

<examples>
【修改】只改某一段：用 before 匹配现有文档中的一段，after 为替换后的内容。

\`\`\`before file="runtime.md"
## SignIn

- title: 登录页
- summary: 用户登录入口页，提供登录按钮。
- type: page
\`\`\`

\`\`\`after file="runtime.md"
## SignIn

- title: 登录页
- summary: 用户登录入口页，提供登录按钮并触发 signIn 完成登录。
- type: page
- events:
  - signIn 登录 - flowchart LR; A["调用 store.signIn"] --> B["校验登录参数"] --> C{"参数是否有效"} -->|有效| D["设置loading状态"] --> E["请求登录接口"] --> F{"请求是否成功"} -->|成功| G["更新用户状态"] --> H["取消loading状态"]; F -->|失败| I["提示错误信息"] --> H; C -->|无效| J["提示参数错误"]
\`\`\`

【整文件替换】仅当需要重写整个 runtime.md 时使用：before 为空，after 为完整的 runtime.md 全文（不是追加，会覆盖整个文件）。

\`\`\`before file="runtime.md"

\`\`\`

\`\`\`after file="runtime.md"
# default

- title: 登录/注册应用入口
- summary: 应用根节点，通过路由提供登录页与注册页的切换与展示。
- type: app

---

## SignIn
...
\`\`\`

【错误】禁止用 \`\`\`md file="runtime.md" 输出整份文档，必须用 before/after 块。
</examples>
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
    stream(params: any, context) {
      const { status, replaceContent } = params;
      const { ToolRetryError } = context ?? {};
      const files = normalizeFiles(params?.files);
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
          const result = config.execute?.({ files: files.map(({ fileName, content }) => ({ fileName, content })) });
          const msg = result ? formatUpdateResult(result) : '';

          if (result && !result.success && ToolRetryError) {
            const errMsg = msg || '执行失败';
            throw new ToolRetryError({
              llmContent:  errMsg + '\n\n 下面是上一轮你的输出 \n\n' + params.content, // 报错过程目前没有代码，需要添加下，后续可以看看
              displayContent: '执行失败，当前操作已回滚，请重试',
              autoRetry: true,
              maxRetries: 1
            });
          }
          if (msg) {
            excuteMessage = msg;
          }
          return raw
            .replace(/runtime\.jsx/g, '')
            .replace(/style\.less/g, '')
            .replace(/store\.js/g, '')
            .replace(/runtime\.md/g, '')
            .replace(/service\.js/g, '') + '\n' + msg;
        }
      }

      return raw
        .replace(/action\.json/g, actionReason)
        .replace(/runtime\.jsx/, '尝试修改内容...').replace(/runtime\.jsx/g, '')
        .replace(/style\.less/, '尝试调整样式...').replace(/style\.less/g, '')
        .replace(/store\.js/, '尝试修改逻辑...').replace(/store\.js/g, '')
        .replace(/service\.js/, '尝试修改接口...').replace(/service\.js/g, '')
        .replace(/runtime\.md/, '尝试修改说明文档...').replace(/runtime\.md/g, '');
    },
  };
}
