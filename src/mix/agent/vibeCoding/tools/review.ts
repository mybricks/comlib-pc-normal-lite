import { formatUpdateResult, UpdateComponentFilesResult, RxFile } from "./utils";
import syncMarkdownformybricksModule from "./syncMarkdownformybricksModule";

const NAME = 'codeReviewAndFix'
reviewMyBricksModule.toolName = NAME

/** onUpdate 返回值：直接返回 UpdateComponentFilesResult 或其 Promise */
export type ExecuteResult = void | UpdateComponentFilesResult | Promise<UpdateComponentFilesResult | void>;

interface Config {
  onUpdate?: (params: { files: Array<{ fileName: string; content: string }> }) => ExecuteResult;
}

// ─── Review 规则定义 ───────────────────────────────────────────────────────────

const RULE_PAGE_REF = `
  <规则: pageRef使用规范>
    - 【强制】所有页面组件必须使用 pageRef 包装，不得使用普通函数组件或 comRef 替代；
    - 整个模块中必须存在至少一个 pageRef 定义；
    - pageRef 组件无需导出；
    - 【违规示例】使用 comRef 定义页面：\`const LoginPage = comRef(() => {...})\`；
    - 【正确示例】\`const LoginPage = pageRef(() => {...})\`；
  </规则>
`;

const RULE_APP_REF = `
  <规则: appRef使用规范>
    - 整个项目有且只能有一个 export default 导出，那就是 appRef；
    - appRef 通常配合 Routes + Route 渲染各个 pageRef 页面；
  </规则>
`;

const RULE_COM_REF = `
  <规则: comRef使用规范>
    - 所有普通组件必须使用 comRef 包装，无需导出；
    - comRef 默认接收保留字段：_env、store、wrapper，禁止通过 props 显式传递这些保留字段；
    - 【违规示例】\`<UserInfo _env={_env} store={store} user={store.user}/>\`；
    - 【正确示例】\`<UserInfo />\`；
  </规则>
`;

const RULE_POPUP_REF = `
  <规则: popupRef使用规范>
    - 所有浮层类组件（弹窗/抽屉等）必须使用 popupRef 包装，无需导出；
    - 控制浮层显示/隐藏状态的变量必须维护在 store 中，禁止设置固定值；
    - 浮层类组件中挂载节点必须指向 wrapper；
  </规则>
`;

const RULE_BLOCK_INDEPENDENCE = `
  <规则: 区块独立性>
    - 拆分的各区块应是独立的：每个区块（非「单项」复用单元）必须自行从 store 读取所需数据、自行调用 store 方法更新；
    - 如果是页面，必须通过pageRef + Route 的方式渲染，禁止在组件内部进行条件渲染；
  </规则>
`;

const RULE_ROUTES = `
  <规则: 路由规范>
    - 路由相关功能必须使用 mybricks 提供的 路由功能，禁止使用第三方路由库；
    - 多页面项目必须在 appRef 中通过 Routes + Route 组织路由，禁止在组件内部进行条件渲染来模拟路由切换；
    - 每个路由页面必须使用 pageRef 包裹，并作为 Route 的 element 传入，element不得使用表达式；
    - 使用 useNavigate 进行页面跳转，禁止直接修改 window.location；
    - 使用 useLocation 获取当前路径信息，使用 useParams 获取动态路由参数；
  </规则>
`;

const RULE_STORE = `
  <规则: store规范>
    - 业务逻辑必须封装在 store 中，禁止在 comRef/pageRef 组件内直接声明 useState 等 hooks；
    - 禁止在 store 内出现 mock 相关代码；
    - 禁止使用 getter 方法；
    - store.js 是纯 JavaScript 文件，禁止出现任何 JSX 语法；
    - 有 service 时，store 必须优先通过 service 调用接口，禁止在 store 内重新声明或使用 mock 数据；
    - 控制浮层显示/隐藏的字段需使用 @PopupVisible 装饰器；
  </规则>
`;

const RULE_LOGGER = `
  <规则: 日志规范>
    - 项目中必须使用 mybricks 提供的 logger 工具打印日志，禁止使用 console.log / console.warn / console.error；
    - 所有 onClick、onChange、onBlur 等事件触发时，必须打印 logger.info；
    - store 中任何方法被调用时，必须打印 logger.info 记录方法名及关键入参；
    - try-catch 的 catch 块必须打印 logger.error；
    - 日志消息应包含上下文前缀：\`[组件名/方法名] 具体描述\`；
  </规则>
`;

// ─── 所有规则集合 ──────────────────────────────────────────────────────────────

const ALL_RULES = [
  RULE_BLOCK_INDEPENDENCE,
  RULE_ROUTES,
  RULE_PAGE_REF,
  RULE_APP_REF,
  RULE_COM_REF,
  RULE_POPUP_REF,
  RULE_STORE,
  RULE_LOGGER,
].join('\n');

// ──────────────────────────────────────────────────────────────────────────────

export default function reviewMyBricksModule(config: Config = {}) {
  let excuteMessage = '';

  return {
    name: NAME,
    displayName: "代码检查",
    description: `对MyBricks模块的代码进行Review和修复，检查代码是否符合规范，发现问题并直接修复发现的问题。
参数：无；
工具分类：操作；

作用：对当前模块代码进行全面的代码审查和自动修复，包括但不限于：
- 检查代码是否符合MyBricks模块规范；
- 检查页面是否正确使用 pageRef；
- 检查组件是否正确使用 comRef；

前置：修改代码后，建议使用此工具进行审查和修复。
`,
    getPrompts: () => {
      return `
<你的角色与任务>
  你是MyBricks模块代码审查专家，技术资深、逻辑严谨、实事求是。
  你的主要任务是对MyBricks模块的代码按照下方的Review规则进行检查和自动修复，发现代码中存在的规范问题，直接通过 before/after 格式进行修复。
</你的角色与任务>

<Review规则>
  以下是必须检查的核心规则，每一条都需要逐一核查：
  ${ALL_RULES}
</Review规则>

<工作流程>
  对于当前模块的代码，按照以下步骤逐一进行审查：
  1. **逐规则检查**：针对上述每一条规则，逐一检查代码是否符合；
  2. **直接修复**：对于所有问题，必须通过 before/after 格式直接输出修复代码；

  注意：仅关注和修复和Review规则相关的问题，其他问题在你这里不属于问题，不需要关注也不需要修复；
</工作流程>

<输出格式>
  先输出 Review 结果摘要，然后对所有可以直接修复的问题通过 before/after 进行修复。

  第一部分：代码审查摘要

  第二部分：修复代码（如有需要修复的问题）

  对于所有问题，使用以下格式修复代码：

  \`\`\`before file="文件名"
（修改前的部分代码内容，保持在文件中唯一，必要时包含上下的行，否则会匹配失败）
  \`\`\`

  \`\`\`after file="文件名"
（修改后的部分代码内容）
  \`\`\`

  对于这些 before 或 after 文件，其内容格式严格遵守以下规则：
  1）before 与 after 必须成对出现，后者是对前者的替换；
  2）before 内容必须与【源代码】中需要被替换的内容完全匹配，包括：
    - 匹配完整的行，不要在行中间截断，如果需要替换的部分包括空行，before 中也需要包含空行;
    - 包括原代码行中所有的空格、缩进、注释、换行符、文档字符串等一切内容;
    - 不允许出现内容省略;
  3）after 内容必须遵守以下规则：
    - 给出完整的行内容，不要在行中间截断;
    - 注意对应 before 结尾处的情况，例如有 , 或 ; 等符号作为代码的一部分，after 中也需要包含;
    - 不允许出现内容省略;
  4）注意 before/after 的分配原则：
    - 每个 before 仅匹配【源代码】中的一段连续的代码行，禁止将多个不连续的代码行放在同一个 before 中；
    - 如果需要对文件中相同的内容进行多次更改，请使用多个 before/after；
    - 在每个 before 部分中，仅包含足够的行以唯一匹配需要更改的内容即可；
    - 按代码中出现的顺序列出多个 before/after；
  5）操作规则：
    - before 非空 且 after 非空 → 内容替换；
    - before 非空 且 after 为空 → 内容删除；
    - before 为空 且 after 非空 → 空文件写入 / 整文件替换；

  注意：
  - 如果某类问题不存在，则不输出该类别；
  - 如果代码整体符合规范，明确说明，无需输出 before/after；
  - 使用中文输出；
  - 回答语气要谦和，言简意赅；
  - 返回的结果中可以使用适当的 html 标签（可以使用 <b/><i/>）以增强良好的阅读体验，不要使用 markdown；
</输出格式>

<examples>

<example>
  <assistant_response>
  审查完毕，发现以下问题：

  <b>发现的问题：</b>

  1. LoginPage 是页面组件，但使用了 comRef 包装，应使用 pageRef；
  2. MainButton 的 onClick 事件缺少 logger.info 日志；

  接下来进行修复：

  \`\`\`before file="runtime.jsx"
  import { comRef, appRef, logger } from 'mybricks';
  import dayjs from 'dayjs';
  \`\`\`

  \`\`\`after file="runtime.jsx"
  import { comRef, pageRef, appRef, Routes, Route, logger } from 'mybricks';
  import dayjs from 'dayjs';
  \`\`\`

  \`\`\`before file="runtime.jsx"
  const LoginPage = comRef(() => {
    return <div>login</div>;
  }
  \`\`\`

  \`\`\`after file="runtime.jsx"
  const LoginPage = pageRef(() => {
    return <div>login</div>;
  }
  \`\`\`

  \`\`\`before file="runtime.jsx"
      <button
        className={css.mainBtn}
        onClick={() => {
          store.click();
        }}
  \`\`\`

  \`\`\`after file="runtime.jsx"
      <button
        className={css.mainBtn}
        /** onClick:click */
        onClick={() => {
          logger.info('[MainButton/onClick] 点击按钮');
          store.click();
        }}
  \`\`\`
  </assistant_response>
</example>

</examples>
`
    },
    execute(params: any, context: any) {
      const files = (params?.files ?? []) as RxFile[];
      const llmContent = `${params.content}\n\n${excuteMessage}`;

      // 如果没有任何文件变更（纯Review无修复），直接返回内容
      if (!files || files.length === 0) {
        return params.content;
      }

      const commands: any = [];

      if (!context.commands?.find((command: any) => command.name === syncMarkdownformybricksModule.toolName)) {
        commands.push({ toolName: syncMarkdownformybricksModule.toolName });
      }

      return {
        llmContent,
        displayContent: llmContent,
        appendCommands: commands.length > 0 ? commands : undefined,
      } as any;
    },
    async stream(params: any, context: any) {
      const { status, replaceContent } = params;
      const { ToolRetryError } = context ?? {};
      const files = (params?.files ?? []) as RxFile[];
      const raw = replaceContent ?? '';

      if (status === 'complete') {
        // 有文件变更时调用 onUpdate 应用修复
        if (files && files.length > 0) {
          const result = await config.onUpdate?.({ files: files.map(({ fileName, content }) => ({ fileName, content })) });
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
              maxRetries: 2
            });
          }

          return raw
            .replace(/runtime\.jsx/g, '')
            .replace(/style\.less/g, '')
            .replace(/store\.js/g, '')
            .replace(/service\.js/g, '')
            .replace(/mock\.json/g, '') + '\n' + msg;
        }

        return raw;
      }

      return params.content;
    },
    aiRole: (_, execCtx) => {
      const retryCount = execCtx?.retryCount ?? 0;
      if (retryCount > 1) return 'architect';
      return;
    },
  };
}
