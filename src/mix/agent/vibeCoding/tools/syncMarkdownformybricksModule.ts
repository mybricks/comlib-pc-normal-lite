const NAME = 'syncMarkdownformybricksModule';

syncMarkdownformybricksModule.toolName = NAME;

export default function syncMarkdownformybricksModule(config) {

  return {
    name: NAME,
    displayName: '根据 runtime.jsx 生成 runtime.md 说明文档',
    description: `将 MyBricks 模块的 runtime.jsx 源码整理成结构化的 runtime.md 文档
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
        - 仅描述该事件处理函数本身的直接调用/操作，不展开 store 的内部流程，例如代码中调用 store 内的 xxx 方法，那么该步骤应该为「"调用 store.xxx"」
        - 流程图节点用动作描述，不写具体取值：例如用「设置loading状态」「取消loading状态」，禁止「设置loading为true」「设置loading为false」等；
        - 禁止出现用户动作类流程节点（如「点击按钮」）、空洞节点（如「开始」「结束」「执行业务操作」）；
    3. 无事件可省略 events
  </节点说明>
</文档编写规范>

<如何更新文档>
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

  <更新示例>

  </更新示例>
</如何更新文档>

<示例>
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
  - signIn 登录 - flowchart LR; A["调用 store.signIn"];

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
  - signUp 注册 - flowchart LR; A["调用 store.signUp"];


\`\`\`
</示例>
`;
    },
    execute({ params }: { params?: { pattern?: string } }) {
      console.log("[params]", params)
      return {
        llmContent: '完成',
        displayContent: '完成',
      };
    },
  };
}
