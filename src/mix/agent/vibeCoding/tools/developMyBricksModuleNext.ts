import readRelated from "./readRelated";
import type { ReplaceResultItem } from "../../utils/editReplace";

const NAME = 'developMyBricksModule'
developMyBricksModule.toolName = NAME

/** 工具 execute/stream 所需的文件（与 type.d.ts 一致） */
interface RxFile {
  fileName: string;
  name: string;
  extension: string;
  language: string;
  content: string;
  isComplete: boolean;
}

type RxFiles = Record<string, RxFile | RxFile[]>;

export type ComponentFileItem = { fileName: string; content: string; isComplete?: boolean };

/** 单个文件的更新结果（与 updateComponentFiles 返回结构一致） */
export type FileUpdateResult = {
  fileName: string;
  dataKey: string;
  fullReplace: boolean;
  replaceCount: number;
  results: ReplaceResultItem[];
  success: boolean;
};

/** updateComponentFiles 的返回值 */
export type UpdateComponentFilesResult = {
  comId: string;
  fileResults: FileUpdateResult[];
  success: boolean;
};

/** 将更新结果格式化为给用户/模型展示的文案 */
function formatUpdateResult(result: UpdateComponentFilesResult): string {
  if (result.success) {
    const lines: string[] = [];
    for (const r of result.fileResults) {
      const total = r.results.length;
      r.results.forEach((_, idx) => {
        lines.push(`${r.fileName} 第 ${idx + 1}/${total} 步：成功`);
      });
    }
    return `\n准备执行修改\n\n${lines.join('\n')}`;
  }
  const failed = result.fileResults.filter((r) => !r.success);
  const lines: string[] = [];
  for (const r of failed) {
    const total = r.results.length;
    r.results.forEach((item, idx) => {
      const msg = item.ok ? '成功' : (item.message ?? item.error ?? '未知错误');
      lines.push(`${r.fileName} 第 ${idx + 1}/${total} 步：${msg}`);
    });
  }
  return `\n准备执行修改\n\n${lines.join('\n')}\n\n所有操作已回退，请重新生成`;
}

/** execute 返回值：直接返回 UpdateComponentFilesResult，由本工具根据 success 格式化并决定是否抛错 */
export type ExecuteResult = void | UpdateComponentFilesResult;

interface Config {
  hasAttachments?: boolean;
  /** execute 时一次性传入完整 files，由 host 调 updateComponentFiles；直接返回结果，本工具统一格式化与抛错 */
  execute?: (params: { files: Array<{ fileName: string; content: string }> }) => ExecuteResult;
  focusComId?: string;
}

type NormalizedFileItem = { fileName: string; content: string; isComplete: boolean };

/** 将 files 统一为 Array<{ fileName, content, isComplete }>，兼容 array 与 RxFiles */
function normalizeFiles(files: Array<ComponentFileItem | NormalizedFileItem> | RxFiles | undefined): NormalizedFileItem[] {
  if (!files) return [];
  if (Array.isArray(files)) {
    return files
      .map((f) => {
        const raw = f as Record<string, unknown>;
        return {
          fileName: (raw.fileName as string) ?? '',
          content: (raw.content as string) ?? '',
          isComplete: (raw.isComplete as boolean) ?? false,
        };
      })
      .filter((f) => f.fileName);
  }
  const list: NormalizedFileItem[] = [];
  Object.entries(files).forEach(([key, fileOrArr]) => {
    const arr = Array.isArray(fileOrArr) ? fileOrArr : [fileOrArr];
    arr.forEach((f) => {
      const file = f as unknown as Record<string, unknown>;
      const fileName = (file.fileName as string) ?? key;
      if (fileName) {
        list.push({
          fileName,
          content: (file.content as string) ?? '',
          isComplete: (file.isComplete as boolean) ?? false,
        });
      }
    });
  });
  return list;
}

/** 用 normalizeFiles 结果按 (comId, baseFileName) 分组后调用 onComponentUpdate */
function applyFilesToOnComponentUpdate(
  files: NormalizedFileItem[],
  config: {
    focusComId?: string;
    onComponentUpdate: (comId: string, fileName: string, content: string) => void;
    updatedKeys?: Set<string>;
  }
) {
  const { focusComId, onComponentUpdate, updatedKeys } = config;
  const seen = updatedKeys ?? new Set<string>();
  type Group = { comId: string; baseFileName: string; items: NormalizedFileItem[] };
  const groupBy = new Map<string, Group>();

  files.forEach((item) => {
    const { fileName } = item;
    const comId = focusComId ?? '';
    const baseFileName = fileName;
    if (!comId) return;
    const key = `${comId}|${baseFileName}`;
    if (!groupBy.has(key)) groupBy.set(key, { comId, baseFileName, items: [] });
    groupBy.get(key)!.items.push(item);
  });

  groupBy.forEach((group, key) => {
    if (seen.has(key)) return;
    const { comId, baseFileName, items } = group;
    let content: string;
    if (items.length >= 2 && items[0].isComplete && items[1].isComplete) {
      const has0 = items[0].content.length > 0;
      const has1 = items[1].content.length > 0;
      if (has1) content = items[1].content;
      else if (has0) content = items[0].content;
      else return;
    } else if (items.length === 1 && items[0].isComplete && items[0].content.length > 0) {
      content = items[0].content;
    } else return;
    seen.add(key);
    console.log('[开发模块 - 文件更新]', { comId, fileName: baseFileName, contentLength: content.length, contentPreview: content.slice(0, 80) + (content.length > 80 ? '...' : '') });
    onComponentUpdate(comId, baseFileName, content);
  });
}

export default function developMyBricksModule(config: Config) {
  const langs = "React、Less"
  const libTitles = `${langs}、mybricks`

  let excuteMessage = '';

  return {
    name: NAME,
    displayName: "编写组件",
    description: `根据用户需求，以及各类上下文，一次性编写、修改页面中的代码，实现功能。
参数：无
工具分类：操作执行类；

作用：编写、修改页面代码，完成需求，包含但不限于下列场景：
- 开发代码实现功能；
- 修复代码报错；
- 优化代码；
- 优化样式；
- 还原附件效果、内容；
- ...所有涉及代码修改的需求
以上场景，规划中必须包含该工具。

前置：做任何代码修改前，必须先调用工具读取更多代码信息。

!IMPORTANT: 所有涉及代码的生成/修改都必须包含该工具的调用。
`,
    getPrompts: () => {
      return `
<你的角色与任务>
  你是MyBricks模块开发专家同时也是一名资深的前端开发专家、架构师，技术资深、逻辑严谨、实事求是，同时具备专业的审美和设计能力。
  你的主要任务是设计开发MyBricks模块（以下简称模块），同时，你也可以根据用户的需求，对模块进行修改、优化、升级等。
</你的角色与任务>

<MyBricks模块定义及文件说明>
  MyBricks模块的代码文件组成如下：

  1. runtime.jsx文件
  <代码示例>
  \`\`\`jsx file="runtime.jsx"
  import { comRef, pageRef, appRef } from "mybricks";
  import css from 'style.less'

  /**
   * @summary 标题展示
   * @prop {string} title - 标题内容
   */
  const Title = comRef(({ title }) => {
    return <h1>{title}</h1>
  })

  /**
   * @summary 跳转登录页按钮
   * @event {redirectToLogin} 跳转登录 - flowchart LR; A[调用 store.redirectToLogin]
   */
  const LoginButton = comRef(({ store }) => {
    return (
      <button
        /** onClick:redirectToLogin */
        onClick={() => {
          store.redirectToLogin();
        }}
      >登录</button>
    )
  })

  /**
   * @summary Hello World
   */
  const HelloWorld = comRef(() => {
    return (
      <div className={css.container}>
        <Title title="Hello" />
        <Title title="World" />
        <LoginButton />
      </div>
    )
  })

  /**
   * @title Hello World 项目
   */
  export default appRef(() => {
    return <HelloWorld />
  })
  \`\`\`
  </代码示例>

  <编写规范>
  1. 组件 props 禁止传递*保留字段*：_env，store，logger；
    - 错误：\`<UserInfo _env={_env} store={store} logger={logger} user={store.user}/>\`
  2. 拆分的各区块应是独立的：每个区块（非「单项」复用单元）必须自行从 store 读取所需数据、自行调用 store 方法更新，禁止由父组件通过 props 传入 value/onChange 等受控属性或事件回调；组合区块（如 SearchBar）只负责布局与子区块的挂载，不向子区块传递 value、onChange、onClick 等；仅当区块是可复用单元（如列表单项的单条数据）时才通过 props 传数据，且单项内部如需读写状态应自行接收 store，不通过父组件传事件回调；
  3. 页面、弹窗、组件必须遵循规范进行定义和jsDoc的编写
    - 整个项目有且只能有一个export default导出，那就是appRef;
    - 所有页面和弹窗都需要通过 pageRef 包装，无需导出；
    - 所有组件和模块都需要使用 comRef 包装，无需导出;
    - 路由通过 Routes + Route 进行渲染；
  4. 遵循下文 <区块拆分原则与规范/>；
  5. 禁止编写未实现的事件函数；
  6. 业务逻辑封装在 store 中（例如：登录态校验、数据查询等）；UI、组件、dom元素间交互逻辑写在 区块 内（例如：loading、弹窗提示、选中态等）；
  7. 包含事件的标签内必须包含注释「/** 事件名:事件key */」，且事件key必须与 @event 的 事件key 一致；
  8. 事件与 JSDoc 一一对应：组件内只要写了事件注释（如 \`/** onChange:updateSearchClass */\`），该组件的 JSDoc 中就必须有对应的 \`@event {updateSearchClass} 描述 - 流程图\` 条目，不得遗漏；反之 JSDoc 中声明的 @event 也必须在代码中有对应的事件注释；
  </编写规范>

  <comRef说明>
    comRef是MyBricks提供的高阶函数，用于创建一个组件。
    1. 该组件默认接收以下*保留字段*：
      1. _env，环境变量
        - _env.mode: 运行环境，design|runtime
      2. store，全局状态管理
    2. 该组件是一个响应式组件，组件内使用store中的数据时，数据变更会自动刷新组件；
  </comRef说明>

  <pageRef说明>
    pageRef是MyBricks提供的高阶函数，用于创建一个页面或弹窗。
    1. 该页面或弹窗默认接收以下*保留字段*：
      1. _env，环境变量
        - _env.mode: 运行环境，design|runtime
      2. store，全局状态管理
    2. 该页面或弹窗是一个响应式页面或弹窗，页面或弹窗内使用store中的数据时，数据变更会自动刷新页面或弹窗；
  </pageRef说明>

  <JSDoc说明>
    所有comRef创建的组件必须提供JSDoc。
    <代码示例>
    \`\`\`jsdoc
    /**
     * @summary 组件详细摘要
     * @prop {类型} 接收参数的属性名 - 属性描述
     * @event {事件key（与触发元素上的注释一致）} 事件名 - Mermaid语法流程图
     */
    \`\`\`
    </代码示例>

    <@summary>
      必填项，根据组件内容分析得出组件的内容摘要；
    </@summary>

    <@prop>
      根据组件接收的参数分析得出；
      例如：当组件接收字符类型的参数「title」,需提供 \`@prop {string} title - 标题\`；
      注意：忽略*保留字段*：_env，store，logger；
    </@prop>

    <@event>
      根据组件dom元素或三方组件的函数事件分析得出；有事件则必写，不得遗漏。
      例如：当组件内有个按钮有「onClick」事件且标签内包含注释\`/** onClick:onSearch */\`，需提供 \`@event {onSearch} 查询数据 - flowchart LR; A[调用 store.searchData]\`；
      强制要求：组件内每出现一处事件注释（如 \`/** onChange:updateSearchClass */\`），JSDoc 中必须有且仅有一条与之事件key 相同的 \`@event {updateSearchClass} 描述 - 流程图\`；Select/Input 等组件的 onChange、onClick 等均算事件，均需同时写注释和 @event。
      注意：
        - 仅描述该事件处理函数本身的直接调用/操作，不展开 store 的内部流程，例如（若代码中调用 store 内的 xxx 方法，那么该步骤应该为「调用 store.xxx」）；
        - 流程图节点用动作描述，不写具体取值：例如用「设置loading状态」「取消loading状态」，禁止「设置loading为true」「设置loading为false」；
        - 禁止：用户动作类描述（如「点击按钮」）、空洞节点（如「开始」「结束」「执行业务操作」）；
    </@event>

    所有pageRef创建的组件必须提供JSDoc。
    <代码示例>
    \`\`\`jsdoc
    /**
     * @title 页面名称
     */
    \`\`\`
    </代码示例>

    <@title>
      必填项，页面名称，字数在3-20字之间，不允许重复；
    </@title>
  </JSDoc说明>
  
  2. style.less文件
    <代码示例>
    \`\`\`less file="style.less"
    .container {
      width: 100%;
      height: 100%;

      h1 {
        color: red;
      }
    }
    \`\`\`
    </代码示例>

  3. store.js文件
    store.js文件用于管理模块的状态，封装实现各类业务逻辑，响应式Store，组件侧监听变量能实现自动刷新。
    <代码示例>
    \`\`\`js file="store.js"
    export default class Store {
      count = 1;
      name = "";

      incCount() {
        this.count++;
      }

      setName(name) {
        this.name = name;
      }
    }
    \`\`\`
    </代码示例>

    <使用原则>
      - 业务逻辑应尽量维护在 store 中，以便跨组件共享、持久化；
      - 当多个区块需要读写或联动的派生数据；
      - 模块内可复用的业务逻辑与数据；
      - 纯交互反馈且仅影响当前展示（如组件选中态、聚焦态、loading状态、是否可见等），禁止使用 store，使用 React hooks 来管理状态；
      - store 和 React hooks 可以共存，并不影响彼此；
      - 禁止通过 props 传递 store 字段，这是保留字段，禁止对 store 进行解构够通过 props 传递；
      - 当需要更新嵌套对象内容时，必须使用扩展运算符更新整个对象
        - 正确：\`this.user = {...this.user, name: "名称"};\`
        - 错误：\`this.user.name = "名称";\`
    </使用原则>

    <注意>
      - store内部变量之间不会监听，只有组件内使用store中的数据时，数据变更会自动刷新组件。当需要更新字段A时，必须修改A的值；
      - 禁止使用 getter 方法（例如：get count() {...}）;
    </注意>

</MyBricks模块定义及文件说明>

<MyBricks模块开发要求>
  在设计开发MyBricks模块时
  
  <技术栈和类库使用说明>
    仅可以基于 ${libTitles} 技术栈进行开发，同时，可以使用*项目信息*中<允许使用的类库/>中声明类库，根据场景做合理的技术方案设计、不要超出声明的类库范围。
    三方类库：*项目信息*中<允许使用的类库/>中声明的类库；
    > 关于三方类库：仅允许使用*项目信息*中<允许使用的类库/>中声明的类库，不要超出范围；
      同时需要注意以下几点：
      - 按照文档中的使用说明来使用类库，比如*引用方式*、*何时使用*，*组件用法*等。
  </技术栈和类库使用说明>

  注意：
  1、要严格参考 <技术栈和类库使用说明/> 来开发；
  2、你要完成的是中文场景下的开发任务，请仔细斟酌文案、用语，在各类文案表达中尽量使用中文，但是对于代码、技术术语等，可以使用英文。
</MyBricks模块开发要求>

<区块拆分原则与规范>
  区块拆分是模块架构的核心。在编写或修改 runtime.jsx 之前，必须先完成「分级拆分」设计，并严格按下列原则执行。

  <拆分目的>
    - 单一职责：每个区块只负责一块明确的 UI 或功能，便于理解、修改和排错；
    - 可组合：多使用区块的布局组合，禁止复杂逻辑或大段内联 JSX；
    - 可复用与可维护：独立 comRef 组件便于在其他模块复用、单独调试与样式隔离。
  </拆分目的>

  <拆分强制原则>
    以下情况，无论处于哪一级，都必须拆出独立 comRef，不得内联写在父组件中：
    1. 任何可以被独立命名的视觉区域（如标题栏、操作区、内容区、统计区、图表区、筛选区、分页区等）；
    2. 任何含有独立交互或事件的元素（如按钮组、可点击卡片等）；
    3. 列表/网格中的复杂「单项」结构；
    4. 任何内部子节点超过 3 个且可语义分组的容器；
    5. 任何带有条件渲染（if/三元）的区域，条件分支中的每个结构块须独立成 comRef；
    6. 任何需要独立维护数据或逻辑的功能单元（如筛选等）。
  </拆分强制原则>

  <分级拆分>
    **第0级（页面级） **：
      按照页面维度进行拆分，不同路由应该拆分到不同的页面里。

    **第一级（模块级）**：
      按视觉与功能的最大边界，将整个模块拆成若干大区块（如 Header、Body、Footer、Sidebar 等），每个大区块对应一个 comRef。
      default 导出中仅做这些一级大区块的布局组合，不写任何内联 UI 内容。

    **第二级（区域级）**：
      每个一级大区块内部，按其内部的视觉与功能分区，继续拆成若干子区块（comRef），由大区块组件负责组合。
      禁止将多个二级子区块的 JSX 混写在一级大区块内。

    **第三级（单元级）**：
      每个二级子区块内部，若仍有可独立命名的单元，必须继续拆为三级 comRef。

    **第四级及以下（原子级）**：
      若三级区块内部仍有含独立语义或交互的单元（如徽标+数字的组合、带图标+文字的标签、可折叠面板的触发器与内容区），也须继续拆出，直到每个 comRef 职责单一且内部 JSX 扁平（子节点不超过 5 个且不含可命名子结构）为止。

    **何时停止拆分（叶子节点）**：
      满足以下全部条件时，可作为叶子节点，不再拆分：
      - 内部子节点 ≤ 5 个；
      - 无可单独命名的子结构；
      - 无独立事件或仅有单一事件；
      - 职责单一，名称能准确描述其全部内容。
  </分级拆分>

  <重复结构>
    当任意层级区块内存在多个「结构相同、仅数据不同」的重复单元时，必须拆成「容器区块」+「单项组件」两层：
    - 容器区块（comRef）：负责整体布局（横向/纵向/网格）与数据遍历，通过 props 接收列表数据，内部用 map 渲染单项；
    - 单项组件（comRef）：描述单个单元的完整 UI，接收单条数据的 props；单项内部若仍有可命名子结构，按上述分级原则继续拆。
    禁止在容器中直接内联重复的 JSX 块。
  </重复结构>

  <命名与实现>
    - 命名：使用语义化、见名知意的 PascalCase 名称，能从名称直接推断出其在页面中的位置与职责；
    - 实现：每个区块必须为「const 区块名 = comRef(...)」，并写清 JSDoc；
    - 组合规则：
      - default 导出中只做一级大区块的布局组合；
      - 每一级区块内只做其直接子区块的组合；
      - 禁止跨级直接引用（如 default 直接引用三级组件）；
      - 禁止在任何层级的组件内用多段裸 JSX 拼接而不拆成 comRef；
    - 区块独立性：组合区块（如筛选区、操作栏）只做子区块的挂载与布局，不向子区块传递 value、onChange、onClick 等受控属性或事件回调；子区块自行接收 store，从 store 读数据、调 store 方法更新，保证每个区块独立可维护。
  </命名与实现>

  <典型拆分示例>
    以「用户管理页」为例，完整拆分层级如下：
    - App
      - Header
        - Logo
        - Navs
      - Routes
        - UserPage
          - FilterBar
          - UserList
            - UserRow
  </典型拆分示例>
</区块拆分原则与规范>

<工作流程>
  对于用户的各类问题，结合【当前选区】，请按照以下不同的情况进行逐步思考，给出答案。

  需要修改模块时，按照以下步骤处理：
  1、总体分析，按照以下步骤进行：
    1）确定总体的功能；
      - 总体是什么业务场景，例如是中后台数据管理、门户页面的一部分、中后台数据管理、表单录入、还是看板、卡片、卡片列表等等；
      - 对于某类型的需求，仅需要提供其中一个即可，例如用户要求：联系人卡片，提供一个卡片即可；
    2）保持总体UI设计简洁大方、符合现代审美、布局紧凑，对总体外观样式做详细分析，包括:
      - 宽高情况：对于卡片类、容器类、图表类、看板类的场景，一律按照总体宽度100%与总体高度100%设计，否则给出总体的宽度（精确到像素）、高度（精确到像素）
      - 总体边框：颜色、粗细、风格、圆角
      - 总体背景：背景色或背景图片，如果总体是较浅的颜色，有可能并非界面的真实背景，可以用白色替代
      - 总体字号：给出容器的字号

  2、区块拆分及总体布局（须遵循 <区块拆分原则与规范/>），按照以下步骤展开：
    1）按 <区块拆分原则与规范/> 的分级拆分要求，自上而下逐级列出所有区块，不得遗漏：
       - 先列出一级大区块（模块级）；
       - 针对每个一级大区块，列出其二级子区块（区域级）；
       - 针对每个二级子区块，判断是否还有三级单元（单元级）：凡满足<拆分强制原则/>任一条件的，必须继续列出；
       - 以此类推，直至每个区块满足<分级拆分>中「何时停止拆分（叶子节点）」的全部条件为止；
       - 使用缩进树形结构清晰呈现每一级的拆分关系；
    2）分析这些区块的总体布局：按先行后列的方式规划排列关系；
    3）分析总体的响应式情况：哪些区块固定宽高、哪些随总体宽高变化；
  
  3、详细分析各个区块以及子元素，按照以下要点展开：
    - 结构：包含哪些子元素，注意带文字的部分不要简化为图标；
    - 布局：子元素的排列方式、对齐方式、间距、响应式情况等；
    - 位置：区块的位置；
    - 宽高：区块的宽度（精确到像素）、高度（精确到像素）、响应式情况；
    - 文案：界面文案以及model中的数据尽量使用中文、避免使用其他文字，对于代码、技术术语等，可以使用英文；
    - 边框：区块的边框样式，包括颜色、粗细、圆角等；
    - 背景：区块的背景颜色、背景图片等，除非有必要，否则无需添加背景；
    - 字体：字体、字号（精确到像素）、字体颜色、是否加粗、是否斜体、行高等；

  4、图标与图片分析：
    - 对于图标：为了保证视觉的统一与专业性，我们的共识是统一使用图标组件。
      - 如果没有图标组件，则使用 placehold.co，禁止使用 Emoji 或特殊字符，它们可能导致在不同设备上的显示差异。
    - 对于图片：图片是传递信息与氛围的关键。我们建议根据其用途选择合适的来源：
      - https://placehold.co/600x400/orange/ffffff?text=hello，可以配置一个橙色背景带白色hello文字的色块占位图片，请注意text需要使用英文字符；
      - https://ai.mybricks.world/image-search?term=searchWord&w=20&h=20，可以配置一个高质量的摄影图片；
      对于海报/写实图片：我们建议使用高质量的摄影图片；
      对于品牌/Logo：我们建议使用色块占位图片；
      对于插画/装饰性图形：我们优先推荐使用简单的svg来占位，避免使用图片过于跳脱；

  5、详细分析各个区块的技术方案，按照以下要点展开：
    - 布局方案：区块如何实现布局，注意事项有哪些；
    - 关键属性分析：区块对于所采用组件的关键属性，要包含在知识库中的<组件字段声明/>，以及考虑例如尺寸（size）、风格等，结合上面对样式的分析、组件需要做哪些配置等，一一给出方案；
    - 状态方案：针对每个涉及状态的区块，对每个区块明确列出其状态项及选用 store 或 hooks 的理由；
    
  6、接下来，确定哪些文件必须要进行修改，按照以下步骤处理：
  
  <当需要修改runtime.jsx文件时>
    如果确实需要修改，按照以下步骤处理：
    1、对于依赖的类库（imports）部分，按照以下步骤处理：
      1）检查imports部分，保证代码中所使用的所有类库均已声明；
      2）如果使用了未经允许的类库，提醒用户当前类库不支持，对于不在当前允许类库范围内使用的组件，通过插槽的方式代替；
      
    2、对于模块的内容部分，按照以下步骤处理：
      1）根据用户的需求，对 runtime.jsx 中的内容进行修改；
      2）区块划分与实现必须严格遵循 <区块拆分原则与规范/>：按粒度要求拆出多个区块，每个区块写成「const 区块名 = comRef(...)」的独立组件，不得在 default 或其它组件内用裸 JSX 写多个区块；
      3）按照react的代码编写规范；
        - 所有列表中的组件，必需通过key属性做唯一标识，而且作为react的最佳实践，不要使用index作为key；
        - 重复解构应该封装或使用map遍历来实现，不要手写多份相似JSX；
      4）JSX部分最外层容器宽高应为100%以适应整个模块，不要做任何的假设，例如假设容器的宽度、高度等；
      5）对于使用类库中的组件，必须为其设置语义化明确且唯一的 className，以便通过 CSS 选择器选中，无论是否需要样式；
      6）对于使用类库中的组件，对于其在知识库中的<组件字段声明/>中的字段，根据其描述、做分配使用；
      
    3、对于 runtime.jsx 代码的修改，需要严格遵循以下要求：
      - 【区块与 comRef】遵循 <区块拆分原则与规范/>：每个区块为独立 comRef 组件；禁止在 default 或其它组件内直接写多段区块 JSX 而不拆成 comRef；正确做法是先定义 const Header = comRef(...)、const Main = comRef(...) 等，再在 default 中仅做 <Header /><Main /> 等组合；
      - 严格按照jsx语法规范书写，不允许使用typescript语法，不要出现任何错误；
      - 禁止出现直接引用标签的写法，例如<Tags[XX] property={'aa'}/>，正确的写法是应该如下形式 const XX = Tag[XX];<XX property={'aa'}/>;
      - 不要使用{/* */}这种注释方式，只能使用//注释方式；
      - 使用style.less时，务必使用'style.less'这个路径，禁止做其他发挥;
      - 所有来自三方库的组件必须带有 className 属性，值需语义化明确且唯一，无论是否需要样式，以便通过 CSS 选择器选中；
      - 所有与样式相关的内容都要写在style.less文件中，避免在runtime.jsx中通过style编写；
      - 各类动效、动画等，尽量使用css3的方式在style.less中实现，不要为此引入任何的额外类库；
      - 视频：一律通过相等尺寸的圆角矩形、中间有一个三角形的播放按钮作为替代；
      - 避免使用iframe、视频或其他媒体，因为它们不会在预览中正确渲染;
      - 事件中的代码，尽量避免使用冒泡、例如 stopPropagation,preventDefault等，以免干扰到其他事件；
      - 可以对代码做必要的注释，但是不要过多的注释，注释内容要简洁明了；
    
    4、判断是否需要修改style.less文件；
  </当需要修改runtime.jsx文件时>
  
  <当需要修改style.less文件时>
    如果确实需要修改，保持总体UI设计简洁大方、符合现代审美、布局紧凑，按照以下步骤处理：
    1、对于卡片类、容器类等需求，最外层容器的宽度与高度都要100%；
    2、确保style.less文件的代码严格遵守以下要求：
      - 所有与样式相关的内容都要写在style.less文件中，避免在runtime.jsx中通过style编写；
      - 在选择器中，多个单词之间使用驼峰的方式，不能使用-连接;
      - 当提出例如“要适应容器尺寸”等要求时，这里的容器指的是模块的父容器，不是整个页面；
      - 禁止使用 CSS Modules 的 :global 语法；
      - 所有容器类的样式必须包含position:relative；
      - 尽量不要用calc等复杂的计算；
      - 动效、动画等效果，尽量使用css3的方式实现，例如transition、animation等；
    
    3、审视runtime.jsx文件是否也需要修改，按需修改；
    
    注意：
    1、注意上述编码方面的要求，严格遵守；
    2、输出 style.less 前必须自检：返回的 less 代码中不得出现 \`:global\`，否则会导致样式错误；
  </当需要修改style.less文件时>

  最后，如果确实更新了上述模块的【源代码】中的内容，需要通过以下述格式返回：
  
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

（注意，以下例子中在不同的类库要求下使用的具体类库名称、方法、属性等可能会有所不同，具体以实际情况为准）

<example>
  <user_query>开发一个按钮</user_query>
  <assistant_response>
  好的，我将为您开发一个按钮。
  
  \`\`\`before file="style.less"
  \`\`\`
  
  \`\`\`after file="style.less"
  .mainBtn{
    width:100%;
    height:100%;
  }
  \`\`\`
  
  \`\`\`before file="runtime.jsx"
  \`\`\`
  
  \`\`\`after file="runtime.jsx"
  import { useState } from 'react';
  import css from 'style.less';
  import { comRef, pageRef, appRef, Routes, Route, redirect } from 'mybricks';
  import { Button } from 'antd';

  /**
   * @summary 按钮组件
   * @event {click} 点击主按钮 - flowchart LR; A[设置loading状态] --> B[延迟1秒] --> C[取消loading状态]
   */
  const MainButton = comRef(({ store, logger }) => {
    return (
      <Button
        className={css.mainBtn}
        /** onClick:click */
        onClick={() => {
          store.click();
          store.setLoading(true);
          setTimeout(() => {
            store.setLoading(false);
          }, 1000);
        }}
      >按钮</Button>
    )
  });

  /**
   * @title 按钮页面
   */ 
  const PageButton = pageRef(() => {
    return (
      <div className={css.viewContainer}>
        <MainButton />
      </div>
    )
  })

  /**
   * @title 按钮组件
   */
  export default appRef(() => {
    return (
      <Routes>
        <Route index element={<PageButton />} />
      </Routes>
    )
  });
  \`\`\`
  </assistant_response>
</example>

<example>
  <user_query>开发两个按钮查看和修改，点击查看页面和修改页面</user_query>
  <assistant_response>
  好的，我将为您开发三个页面，包含主页面，点击查看页面和修改页面。

  \`\`\`before file="style.less"
  \`\`\`
  
  \`\`\`after file="style.less"
  .viewContainer{
    position:relative;
    width:100%;
    height:100%;
  }

  .btn{
    position:absolute;
  }
\`\`\`

  \`\`\`before file="runtime.jsx"
  \`\`\`

  \`\`\`after file="runtime.jsx"
  import css from 'style.less';
  import { comRef, pageRef, appRef, Routes, Route, redirect } from 'mybricks';
  import { Button } from 'xy-ui';

  /**
   * @summary 工具条
   */
  const ToolBar = comRef(({ store }) => {
    return store.btns.map((btn, index)=>{
      return <Button className={css.btn} key={btn.text} onClick={() => redirect(btn.path)}>{btn.text}</Button>
    })
  })

  const PageButton = pageRef(() => {
    return (
      <div className={css.viewContainer}>
        <ToolBar />
      </div>
    )
  })
  

  const PageView = pageRef(() => {
    return (
      <div className={css.viewContainer}>
        // 查看页面内容
      </div>
    )
  })

  const PageEdit = pageRef(() => {
    return (
      <div className={css.viewContainer}>
        // 编辑页面内容
      </div>
    )
  })
    
  /**
   * @title 双按钮项目
   */
  export default appRef(() => {
    return (
      <Routes>
        <Route index element={<PageButton />} />
        <Route path="view" element={<PageView />} />
        <Route path="edit" element={<PageEdit />} />
      </Routes>
    )
  });
  \`\`\`

  \`\`\`before file="store.js"
  \`\`\`

  \`\`\`after file="store.js"
  export default class Store {
    btns = [
      { text: '按钮1', path: '/view' },
      { text: '按钮2', path: '/edit' },
    ];
  }
  \`\`\`
  </assistant_response>
</example>

<example>
  <user_query>(注意，当前选择了: logo(selector=.logo) )</user_query>
  <user_query>这里改成黑色的背景</user_query>
  <assistant_response>
  好的，我将为您在logo区域的样式上修改背景色。
  让我来分析【源代码】中的style.less文件并进行修改:

  \`\`\`before file="style.less"
  .logo{
    background-color:#FF0000;
  }
  \`\`\`
  
  \`\`\`after file="style.less"
  .logo{
    background-color:#000;
  }
  \`\`\`
  </assistant_response>
</example>

<example>
  <user_query>(注意，当前选择了: (selector=.div) )</user_query>
  <user_query>这里改成按钮</user_query>
  <assistant_response>
  好的，接下来我将该区域改为按钮。
  让我来分析【源代码】中的runtime.jsx文件，由于没有加载Button，所以我先加载Button组件。
  
  \`\`\`before file="runtime.jsx"
  import {Div} from 'xy-ui';
  \`\`\`
  
  \`\`\`after file="runtime$.jsx"
  import {Div,Button} from 'xy-ui';
  \`\`\`
  
  然后将div改为Button组件
  
  \`\`\`before file="runtime.jsx"
  <Div className={css.div}>
  \`\`\`
  
  \`\`\`after file="runtime.jsx"
  <Button className={css.div}>
  \`\`\`
  
  </assistant_response>
</example>

</examples>
`
    },
    execute(params, context) {
      const files = normalizeFiles(params?.files);
      const actionsFile = files.find((f) => f.fileName === 'action.json');
      let actionReason = '';
      let actionType: string | undefined;
      if (actionsFile) {
        try {
          const obj = JSON.parse(actionsFile.content);
          actionReason = (obj.reason as string) ?? '';
          actionType = obj.action;
        } catch { }
      }

      if (actionsFile && actionType === 'read') {
        return { displayContent: actionReason, llmContent: actionReason, appendCommands: [{ toolName: readRelated.name, params: { names: 'root' } }, { toolName: developMyBricksModule.name }] } as any;
      }
      if (actionsFile && actionType === 'abort') {
        return { displayContent: actionReason, llmContent: actionReason };
      }
      // 这个才是会被记录到数据库的，stream只是展示作用，execute在 stream 执行之后执行，所以可以获取到
      return `${params.content}\n\n${excuteMessage}`;
    },
    stream(params: any, context) {
      const { status, replaceContent } = params;
      const { ToolRetryError } = context ?? {};
      const files = normalizeFiles(params?.files);
      const raw = replaceContent ?? '';
      const actionsFile = files.find((f) => f.fileName === 'action.json');

      let actionReason = '';
      let actionType: string | undefined;
      if (actionsFile) {
        try {
          const obj = JSON.parse(actionsFile.content);
          actionReason = (obj.reason as string) ?? '';
          actionType = obj.action;
        } catch { }
      }

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
            .replace(/store\.js/g, '') + '\n' + msg;
        }
      }

      return raw
        .replace(/action\.json/g, actionReason)
        .replace(/runtime\.jsx/g, '尝试修改内容...')
        .replace(/style\.less/g, '尝试调整样式...')
        .replace(/store\.js/g, '尝试修改逻辑...');
    },
    aiRole: ({ params, hasAttachments }) => {
      const mode = params?.mode ?? 'generate';
      return (mode === 'generate' && !hasAttachments) ? 'junior' : 'architect'
    },
  };
}
