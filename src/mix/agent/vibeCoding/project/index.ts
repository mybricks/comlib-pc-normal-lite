/**
 * Project - 项目空间
 * 根据 project.json 生成实时更新的 message：项目架构树 + 文件系统（按组件 name 展开代码）
 */

import { getEffectiveLibraryDocs } from '../../../availableLibraries';


/** project.json 中单个节点的类型 */
export interface ProjectNode {
  name: string;
  specs: { summary?: string; props?: Record<string, string>; events?: Record<string, string> };
  contents: Array<{ path: string; locs: number[][] }>;
  /** 根节点可选：默认展开的引用部分，如 runtime.jsx 的 import 区间 */
  commonImports?: Array<{ path: string; locs: number[][] }>;
  children: ProjectNode[];
  /** 组件上方 JSDoc 注释在 runtime 中的行区间 [起始行, 结束行]（1-based） */
  comments?: [number, number];
  /** 组件定义（const X = comRef(...) 或 export default comRef(...)）在 runtime 中的行区间 [起始行, 结束行]（1-based） */
  def?: [number, number];
}

/** 根组件 name，传入时展开整个项目所有代码 */
export const ROOT_NAME = 'root';

/** 项目配置 */
export interface ProjectConfig {
  /** project.json 根数组（仅取第一个根节点） */
  /** 获取主题配置全文 */
  getThemesContent: () => string;
  /** 获取代码规则（Markdown） */
  getCodeRules?: () => string;
  /** 获取设计规则（Markdown） */
  getDesignRules?: () => string;
  /** 获取设计器运行时状态（由渲染层写入） */
  getDesignerState?: () => { pages: string[]; popups: string[] } | undefined;
  /** 获取当前运行时报错列表 */
  getErrors?: () => Array<{ message: string; type: string; file?: string }> | undefined;
  /** 获取本次组件加载后收集到的日志列表（每次重载重置） */
  getLogs?: () => Array<{ type: string; method: string; args: any[]; timestamp: number; mode?: string }> | undefined;
  /** createProject 时快照的 runtimeMode（`${id}_edit` / `${id}_runtime_mock` 等），用于过滤日志和固定设计器状态描述 */
  snapshotRuntimeMode?: string;


  getFiles: () => any[];
}

const RUNTIME_PATH = '/runtime.jsx';
const STYLE_PATH = '/style.less';
const STORE_PATH = '/store.js';
const SERVICE_PATH = '/service.js';
/** 折叠占位提示（不耦合具体工具名） */
const FOLD_HINT = '// ... 这部分代码已折叠，如需要可通过读取工具打开 ...';

/** 合并多个区间（按 start 排序并合并重叠） */
function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

/**
 * 将节点树转为简洁树状列表：name + title(summary) + 入参/事件（只列名称，不写类型）
 */
function buildArchitectureMd(node: ProjectNode, indent = ''): string {
  const { name, specs } = node;
  const title = specs?.summary ?? '';
  // const propKeys = specs?.props ? Object.keys(specs.props) : [];
  // const eventKeys = specs?.events ? Object.keys(specs.events) : [];
  // const propsStr = propKeys.length ? `props：${propKeys.join(', ')}` : '';
  // const eventsStr = eventKeys.length ? `事件：${eventKeys.join(', ')}` : '';
  // const extra = [propsStr, eventsStr].filter(Boolean).join('；');
  const line = `- ${name}${title ? ` — ${title}` : ''}`;
  const childrenMd = node.children?.length
    ? node.children.map((child) => buildArchitectureMd(child, indent + '  ')).join('\n')
    : '';
  return childrenMd ? `${indent}${line}\n${childrenMd}` : `${indent}${line}`;
}

/**
 * 在树中按 name 查找节点
 */
function getNodeByName(root: ProjectNode, name: string): ProjectNode | null {
  if (root.name === name) return root;
  for (const child of root.children ?? []) {
    const found = getNodeByName(child, name);
    if (found) return found;
  }
  return null;
}

/**
 * 收集某节点及其所有后代节点的 name（包含自身）
 */
function collectNodeAndDescendantNames(node: ProjectNode): string[] {
  const result = [node.name];
  for (const child of node.children ?? []) {
    result.push(...collectNodeAndDescendantNames(child));
  }
  return result;
}

/**
 * 从树中收集某组件名对应的所有 locs（按文件路径分组）
 * 同一 name 可能对应多个节点（多次引用），取第一个节点的 contents 作为该 name 的代码范围
 */
function getLocsByComponentName(root: ProjectNode, componentName: string): Array<{ path: string; locs: number[][] }> {
  let found: ProjectNode | null = null;
  function walk(n: ProjectNode) {
    if (found) return;
    if (n.name === componentName) {
      found = n;
      return;
    }
    (n.children ?? []).forEach(walk);
  }
  walk(root);
  const node = found as ProjectNode | null;
  return node?.contents ?? [];
}

/**
 * 收集「初始默认展开」的 runtime 区间：所有组件的注释全文 + 组件定义的仅首行与末行（不含中间函数体）
 * 用于文件系统一打开就展示 imports、各组件 JSDoc、以及每个组件定义的起止行
 */
function getInitialComponentRangesForRuntime(root: ProjectNode): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  function walk(node: ProjectNode) {
    if (node.comments) ranges.push({ start: node.comments[0], end: node.comments[1] });
    if (node.def) {
      ranges.push({ start: node.def[0], end: node.def[0] });
      if (node.def[1] !== node.def[0]) ranges.push({ start: node.def[1], end: node.def[1] });
    }
    (node.children ?? []).forEach(walk);
  }
  walk(root);
  return ranges;
}

/**
 * 根据已展开的组件名，收集某文件下所有要展开的区间（合并重叠）
 * 返回 [{ start, end }] 按 start 排序且不重叠
 */
function getExpandedRangesForFile(
  root: ProjectNode,
  expandedNames: Set<string>,
  filePath: string
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  expandedNames.forEach((name) => {
    const contents = getLocsByComponentName(root, name);
    contents
      .filter((c) => c.path === filePath)
      .forEach((c) => {
        (c.locs ?? []).forEach(([start, end]) => ranges.push({ start, end }));
      });
  });
  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

/**
 * 将文件内容按行展示：已展开区间显示代码，未展开区间用同一折叠提示占位，整体一个代码块
 */
function buildFileSection(
  fileName: string,
  fullContent: string,
  expandedRanges: Array<{ start: number; end: number }>,
  lang: string
): string {
  const lines = fullContent.split(/\r?\n/);
  const totalLines = lines.length;
  if (totalLines === 0) {
    return `\n#### ${fileName}\n\n\`\`\`${lang}\n(空文件)\n\`\`\`\n`;
  }

  const bodyParts: string[] = [];
  let lastEnd = 0;

  if (expandedRanges.length === 0) {
    bodyParts.push(FOLD_HINT);
  } else {
    for (const r of expandedRanges) {
      const start = Math.max(1, r.start);
      const end = Math.min(totalLines, r.end);
      if (start > lastEnd + 1) {
        bodyParts.push(FOLD_HINT);
      }
      bodyParts.push(lines.slice(start - 1, end).join('\n'));
      lastEnd = end;
    }
    if (lastEnd < totalLines) {
      bodyParts.push(FOLD_HINT);
    }
  }

  const oneBlock = bodyParts.join('\n\n');
  return `\n#### ${fileName}\n\n\`\`\`${lang}\n${oneBlock}\n\`\`\`\n`;
}

/**
 * Project 类：根据 project.json 生成实时更新的 message
 */
export class Project {
  private config: ProjectConfig;
  // private root: ProjectNode;
  /** 通过 read(name) 展开的组件名集合 */
  private expandedNames = new Set<string>();
  /** createProject 时快照的 runtimeMode，用于固定 exportDesignerToMessage / exportLogsToMessage 的视角 */
  private snapshotRuntimeMode: string | undefined;

  constructor(config: ProjectConfig) {
    this.config = config;
    this.snapshotRuntimeMode = config.snapshotRuntimeMode;
  }

  /**
   * 按组件 name 展开其相关代码，后续 exportToMessage 会包含该组件在各代码文件（如 runtime、style 等）中的代码行。
   * 打开父节点时会同时展开该节点及其所有子节点（递归）的代码区间。
   * 传入 "root" 时直接返回全量文件（所有代码文件全文）。
   */
  read(componentName: string): void {
    // if (!componentName || typeof componentName !== 'string') return;
    // const name = componentName.trim();
    // const node = getNodeByName(this.root, name);
    // if (node) {
    //   collectNodeAndDescendantNames(node).forEach((n) => this.expandedNames.add(n));
    // } else {
    //   this.expandedNames.add(name);
    // }
  }

  /**
   * 取消展开某组件（可选）
   */
  unread(componentName: string): void {
    this.expandedNames.delete(componentName?.trim());
  }

  /**
   * 获取当前已展开的组件名列表
   */
  getExpandedNames(): string[] {
    return Array.from(this.expandedNames);
  }

  /**
   * 获取项目架构中所有组件 name（含 root）
   */
  // getComponentNames(): string[] {
  //   return collectNodeAndDescendantNames(this.root);
  // }

  /**
   * 当前设计器是否有运行时错误
   */
  hasRuntimeErrors(): boolean {
    const errors = this.config.getErrors?.() ?? [];
    return errors.length > 0;
  }

  /**
   * 将本次载入的运行日志格式化为 Markdown 字符串，供 checkDesignStatus 拼接
   */
  exportLogsToMessage(maxCount = 30, maxArgLength = 50): string {
    const allLogs = this.config.getLogs?.() ?? [];
    // 若有快照 runtimeMode，只展示该模式下的日志；否则展示全部
    const filtered = this.snapshotRuntimeMode
      ? allLogs.filter((entry) => entry.mode === this.snapshotRuntimeMode)
      : allLogs;
    const logs = filtered.slice(-maxCount);
    const truncatedCount = filtered.length - logs.length;
    if (logs.length === 0) {
      return `\n## 运行日志\n  （本次载入暂无日志）\n`;
    }
    const logLines = logs.map((entry, i) => {
      const argsStr = entry.args.map((a: any) => {
        let s: string;
        try { s = JSON.stringify(a); } catch { s = String(a); }
        return s.length > maxArgLength ? s.slice(0, maxArgLength) + '…' : s;
      }).join(', ');
      return `  ${i + 1}. [${entry.type}] ${entry.method}(${argsStr})`;
    }).join('\n');
    const truncatedNote = truncatedCount > 0
      ? `\n  （已省略最早的 ${truncatedCount} 条，仅展示最近 ${maxCount} 条）`
      : '';
    return `\n## 运行日志（按顺序）${truncatedNote}\n${logLines}\n`;
  }

  async exportDesignerToMessage(): Promise<string> {
    const designModeKnowledge = `
## 页面渲染：
通过 Route 注册的组件统一定义为页面；
### 设计态渲染方式
  - 在设计态中，所有通过Route注册的页面会被同时平铺按顺序展示，而非只显示当前激活路由对应的组件；
  - 这意味着每个通过 Route 注册的 comRef 组件都会在画布上独立渲染，设计者可以直接看到并编辑所有页面；
  - 在设计态中，所有通过 popupRef 包裹的浮层类组件会被同时平铺展示；
  - 这意味着每个通过 popupRef 包裹的浮层类组件都会在画布上独立渲染，设计者可以直接看到并编辑所有浮层类组件（例如弹窗、抽屉等）；
### 运行态渲染方式
  - 在运行态中，只有当前激活路由对应的页面会被展示；
  - 在运行态中，通过 popupRef 包裹的浮层组件（弹窗、抽屉等）展示与否是受控的，通过用户交互或代码逻辑主动触发才会显示；
  
## 接口请求
设计态会替换axios的内部实现，不允许请求真实接口，需要提供 mock 数据。
`;

    const state = this.config.getDesignerState?.();
    // 优先使用创建时快照的 runtimeMode 推断模式；否则回退到实时状态
    let mode: string;
    if (this.snapshotRuntimeMode) {
      mode = this.snapshotRuntimeMode.endsWith('_edit') ? 'design' : (state?.mode ?? 'design');
    } else {
      mode = state?.mode ?? 'design';
    }
    const modeLabel = mode === 'design' ? '设计态' : `运行态(${mode.replace(/^.*_runtime_/, '')}环境)`;
    
    const pageRefNames = state?.pages ?? [];
    const popupRefNames = state?.popups ?? [];

    const errors = this.config.getErrors?.() ?? [];

    let canvasStatus: string;
    if (errors.length > 0) {
      const errorLines = errors.map((e, i) => `  ${i + 1}. [${e.type}]${e.file ? ` ${e.file}` : ''}: ${e.message}`).join('\n');
      canvasStatus = `画布当前处于报错状态，暂时无法看见任何展示内容。错误列表如下：\n${errorLines}`;
    } else if (pageRefNames.length === 0 && popupRefNames.length === 0) {
      canvasStatus = '当前代码暂无页面或弹窗组件，画布尚无可展示内容。';
    } else {
      // 页面在前、弹窗在后，与设计态画布实际渲染顺序一致
      const allZones = [
        ...pageRefNames.map((name) => ({ name, kind: '页面' })),
        ...popupRefNames.map((name) => ({ name, kind: '弹窗/浮层' })),
      ];
      const zonesList = allZones.map((z, i) => `  ${i + 1}. ${z.name}（${z.kind}）`).join('\n');
      canvasStatus = `画布从左到右共渲染了 ${allZones.length} 个画布（页面 ${pageRefNames.length} 个，弹窗/浮层 ${popupRefNames.length} 个），依次为：
${zonesList}`;
    }

    const curStatus = `
## 设计态渲染情况
${canvasStatus}

## 当前状态
状态：${modeLabel}
`    
    return [
      '# 设计器状态（实时更新）',
      '由于当前在MyBricks设计器中进行搭建和开发，设计器会区分「设计态」和「运行态」，两种模式下展示的内容不一样',
      designModeKnowledge,
      curStatus
    ].join('\n');
  }

  /**
   * 生成实时 message（Markdown）
   */
  async exportToMessage(): Promise<string> {
    const { getFiles, getThemesContent, getCodeRules, getDesignRules } = this.config;
    const themesContent = getThemesContent();
    const codeRules = getCodeRules?.() ?? '';
    const designRules = getDesignRules?.() ?? '';

    const projectSpaceDesc = `这是组成整个页面的仓库和源代码。
注意：除了获取/修改代码的情况，不要告知用户有这个架构、工具、文件系统的存在，用户不是专业开发者，不懂这些信息。`;

    const codeRulesSection = codeRules.trim()
      ? `\n<code_rules>\n${codeRules.trim()}\n</code_rules>\n`
      : '';

    const designRulesSection = designRules.trim()
      ? `\n<design_rules>\n${designRules.trim()}\n</design_rules>\n`
      : '';

    // 最佳实践：在此补充项目约定的开发习惯、推荐写法等，供 Agent 参考
    const bestPracticesContent = `${codeRulesSection}${designRulesSection}
- 总体规则
  - 开发规范：参考下方mybricks类库的的最佳实践；
  - 功能：生产级别的功能性；
  - 细节：在每个细节都精心完善；
  - 响应式：保证合理统一的间距，以及支持宽度变化自适应的代码；
  - 当前每一个设计态画布默认宽度为1200px，可以通过样式文件中使用 :frame { width: 1660px } 统一配置画布宽度；
    - 如果是PC端界面，画布宽度配置常见的 1200、1660、1920 等宽度；
    - 如果是移动端界面，画布宽度建议配置414宽度；
- 拆分逻辑
  - 精准识别到底是页面还是弹窗，对其进行拆分，如果是页面，需要使用Route渲染，如果是弹窗，需要使用popupRef；
  - 我们特别希望在设计态能够展示所有页面和弹窗，方便用户进行调试；
- 静态资源：
  - 对于图标：为了保证视觉的统一与专业性，我们的共识是统一使用图标组件。
    - 如果没有图标组件，则使用 placehold.co，禁止使用 Emoji 或特殊字符，它们可能导致在不同设备上的显示差异。
  - 对于图片：图片是传递信息与氛围的关键。我们建议根据其用途选择合适的来源：
    - https://placehold.co/600x400/orange/ffffff?text=hello，可以配置一个橙色背景带白色hello文字的色块占位图片，请注意text需要使用英文字符；
    - https://ai.mybricks.world/image-search?term=searchWord&w=20&h=20，可以配置一个高质量的摄影图片；
    对于海报/写实图片：我们建议使用高质量的摄影图片；
    对于品牌/Logo：我们建议使用色块占位图片；
    对于插画/装饰性图形：我们优先推荐使用简单的svg来占位，避免使用图片过于跳脱；
- 美学指南：
  - 在浅色和深色主题、不同字体、美学之间变化；
${themesContent}
注意：永远不要使用通用的AI生成美学、陈词滥调的配色方案（特别是白色背景上的紫色渐变）、可预测的布局，以及缺乏特征的千篇一律的设计。
`;

    const libraryDocsContent = getEffectiveLibraryDocs();
    const fileSectionParts: string[] = [];

    fileSectionParts.push('\n## 源代码\n');
    fileSectionParts.push('包含项目中的各代码文件。所有折叠内容可通过读取工具展开\n');

    const files = getFiles();

    files.forEach((file) => {
      const { fileName, source } = file;
      const content = decodeURIComponent(source);
      const lines = content.split(/\r?\n/);
      const ranges = [{ start: 1, end: lines.length }];
      const suffix = fileName.split('.').pop();

      if (ranges.length > 0) {
        fileSectionParts.push(
          buildFileSection(fileName, content, ranges, suffix)
        );
      } else {
        fileSectionParts.push(buildFileSection(fileName, content, [], suffix));
      }
    })

    const architectureContent = `
#### 模块目录结构
\`\`\`
├─ index.jsx           # 模块入口，有且仅有一个，必须写在根路径
├─ index.less
├─ store.js            # 全局 store（可选）
├─ dataSource.js       # 项目唯一文件，必须
├─ setup.js            # 项目唯一文件，必须
├─ pages
|  └── HomePage
|     ├── index.jsx
|     ├── index.less
|     ├── store.js     # 页面级 store（可选）
|     └── SubComponent
|        ├── index.jsx
|        └── index.less
└─ components
   └── SharedComponent
      ├── index.jsx
      └── index.less
\`\`\`

#### 页面与组件的文件拆分
- index.jsx：模块入口，有且仅有一个，且必须写在根路径的 \`index.jsx\` 中；
- pages/xxx：页面，每个页面必须单独拆到**文件夹**中，例如 \`pages/HomePage/index.jsx\`、\`pages/UserPage/index.jsx\`；
- 组件：每个组件可以是单独的一个文件或目录，文件位置按是否有复用价值决定：
  - 有复用价值（可以被多个页面或组件复用）：放在 \`components/组件名/\` 下（如 \`components/Header/index.jsx\`）；
  - 无复用价值（仅当前页面使用）：可放在**当前页面目录下**（如 \`pages/HomePage/Title.jsx\`、\`pages/UserPage/FilterBar/index.jsx\`），不必强行放在 components 下；

#### jsx 文件编写规范
1. 组件 props 禁止传递保留字段（\`_env\`、\`popupNode\`）以及 store 数据：
   - 错误：\`<UserInfo _env={_env} popupNode={popupNode} store={store} user={store.user} />\`
   - 正确：\`<UserInfo />\`
2. 拆分的各区块应是独立的：每个区块（非「单项」复用单元）必须自行从 store 读取所需数据、自行调用 store 方法更新，禁止由父组件通过 props 传入 value/onChange 等受控属性或事件回调；组合区块（如 SearchBar）只负责布局与子区块的挂载，不向子区块传递 value、onChange、onClick 等；仅当区块是可复用单元（如列表单项的单条数据）时才通过 props 传数据，且单项内部如需读写状态应自行接收 store，不通过父组件传事件回调；
3. 禁止编写未实现的事件函数；
4. 业务逻辑封装在 store 中（例如：登录态校验、数据查询等）；
5. 组件各类状态控制维护在 store 中（例如：loading、选中态、状态切换等）；
6. 包含事件（例如 onClick、onChange、onBlur 等）的标签内必须包含注释「/** 事件名:事件key */」；
7. 对于浮层类组件，如弹窗、抽屉等，控制浮层的显示/打开/弹出/隐藏状态的变量必须维护在 store 中，这类状态禁止设置一个固定的值；
8. 严格遵守 jsx 语法规范，不允许使用 typescript 语法；
9. 不要使用 \`{/* */}\` 这种注释方式，只能使用 \`//\` 注释方式；
10. 所有来自三方库的组件必须带有 className 属性，值需语义化明确且唯一，无论是否需要样式，以便通过 CSS 选择器选中；
11. 所有与样式相关的内容都要写在 less 文件中，避免在 jsx 中通过 style 编写；
12. 各类动效、动画等，尽量使用 css3 的方式在 less 中实现，不要为此引入任何的额外类库；
13. 禁止出现直接引用标签的写法，例如 \`<Tags[XX] property={'aa'}/>\`，正确的写法是先定义 \`const XX = Tag[XX]; <XX property={'aa'}/>\`；
14. 所有列表中的组件，必须通过 key 属性做唯一标识，不要使用 index 作为 key；

保留字段（禁止通过 props 传递）：
- \`_env\`：环境变量，\`_env.mode\` 表示运行环境（design | runtime）；
- \`popupNode\`：浮层挂载目标 DOM 节点，浮层类组件必须挂载到此节点上；

comRef 说明：
- comRef 是 MyBricks 提供的高阶函数，用于创建一个组件；
- 该组件默认接收保留字段；
- 该组件是响应式组件，组件内使用 store 中的数据时，数据变更会自动刷新组件；

popupRef 说明：
- popupRef 是 MyBricks 提供的高阶函数，用于创建浮层类组件（弹窗、抽屉等）；
- 该组件默认接收保留字段；
- 该浮层类组件是响应式的，数据变更会自动刷新；

PopupVisible 装饰器说明：
- PopupVisible 是一个属性装饰器，用于将浮层类组件在**设计态**下将变量默认设置为**打开状态**，这样设计者才能选中浮层内部的元素进行编辑；
- 对于浮层类组件的打开与否，不需要在 runtime 层控制，统一由装饰器进行管理；

#### less 文件编写规范
1. 严格参考设计风格与主题变量使用说明来编写样式；若项目提供了主题变量，编写前必须先列举全部可用变量，再对照每条样式属性逐一检查是否有对应变量，有则必须使用，禁止硬编码已有主题变量所覆盖的色值或数值；
2. :frame 配置规则（仅页面和浮层类组件需要，普通组件不需要）：
   - 每个页面（page），必须配置 :frame { width }，宽度参考设计稿或 1440px（若无设计稿）；
   - 每个浮层类组件（由 popupRef 创建的组件），必须配置 :frame { width; height }，宽度与页面保持一致（同为 1440px 或设计稿宽度），高度在弹窗内容实际高度基础上额外增加 200～300px，以留出遮罩层空间（如内容约 400px 则配置 height: 650px）；
   - :frame 只控制画布尺寸，不影响运行时布局，必须放在所有 CSS 类之前；
   - :frame 只在首次创建页面或浮层类组件或者有重大 UI 重构时才需要重新估算；
3. 在选择器中，多个单词之间使用驼峰方式，不能使用 - 连接；
4. 所有容器类的样式必须包含 \`position: relative\`；
5. 尽量不要用 calc 等复杂的计算；
6. 动效、动画等效果，尽量使用 css3 的方式实现，例如 transition、animation 等；
7. 不使用 :before、:after 等伪类选择器来实现 dom；

#### store.js 文件编写规范
只有入口、页面可以编写 store.js 文件，即可以封装全局 store 和页面级 store；store.js 文件用于管理全局、页面的状态，封装实现各类业务逻辑，响应式 Store，组件侧监听变量能实现自动刷新。

使用原则：
- 文件名必须是 \`store.js\`；
- 业务逻辑应尽量维护在 store 中，以便跨组件共享、持久化；
- 当多个区块需要读写或联动的派生数据时，放在 store 中；
- 模块内可复用的业务逻辑与数据放在 store 中；
- 禁止与 React hooks 混用；
- 禁止通过 props 传递 store 字段，禁止对 store 进行解构后通过 props 传递；
- 当需要更新嵌套对象内容时，必须使用扩展运算符更新整个对象：
  - 正确：\`this.user = {...this.user, name: "名称"};\`
  - 错误：\`this.user.name = "名称";\`

编写规范：
1. 当字段用于控制浮层类组件的显示/隐藏状态时，需要对该字段使用装饰器 @PopupVisible；
2. 默认导出实例化后的 store；
3. 必须使用 makeAutoObservable；

注意：
- store 内部变量之间不会监听，只有组件内使用 store 中的数据时，数据变更才会自动刷新组件；当需要监听组件 A 变化刷新 UI 时，必须在组件内读取 A 的值，当需要更新字段 A 时，必须修改 A 的值；
- store 是纯 class 实例，不提供也不支持任何 hooks API（例如 store.useState、store.useXxx 等均不存在），禁止调用；
- 禁止使用 getter 方法（例如：get count() {...}）；
- 任何数据初始化动作都不允许写在 constructor 内；
- 禁止在 React 函数组件内直接调用 store 的数据初始化方法（如 store.init()、store.fetchData() 等），这会在每次渲染时重复执行，极易导致死循环；如需初始化，必须放在 useEffect 内执行；
- store.js 是纯 JavaScript 文件，禁止出现任何 JSX 语法（例如 <Icon />、<div> 等标签），也禁止从任何 UI 组件库引入 JSX 组件并作为字段值存储；

#### 日志规范
项目中必须使用 mybricks 提供的 \`logger\` 工具打印日志，禁止使用 console.log / console.warn / console.error 等原生方法。

必须在以下所有场景中打印足量日志，确保运行时行为可追踪、可排查：
1. 用户交互事件：所有 onClick、onChange、onBlur 等事件触发时，打印 logger.info 记录操作行为及关键参数；
2. 数据请求：接口调用前打印 logger.info 记录请求参数，请求成功后打印 logger.info 记录返回数据摘要，请求失败时打印 logger.error 记录错误信息；
3. 状态变更：store 中任何方法被调用时，打印 logger.info 记录方法名及关键入参；
4. 条件分支与异常：进入关键条件分支时打印 logger.info 说明走了哪个分支；try-catch 中 catch 块必须打印 logger.error 记录异常；
5. 路由跳转：导航跳转时打印 logger.info 记录目标路径；
6. 任何可能失败的操作（如数据解析、类型转换等）都需要用 try-catch 包裹，并在 catch 中使用 logger.error 打印错误详情；

日志格式要求：
- 日志消息应包含上下文前缀，便于定位来源，格式推荐：\`[组件名/方法名] 具体描述\`；
- 示例：\`logger.info('[UserList/fetchUsers] 开始请求用户列表', { page: 1 })\`；
- 错误日志必须携带 error 对象：\`logger.error('[Store/loadData] 数据加载失败', error)\`；

#### 区块拆分原则与规范
区块拆分的核心目标是：代码清晰可维护、逻辑内聚、减少不必要的文件碎片。必须同时兼顾「编程视角」（复用性、状态独立性、逻辑复杂度）和「视觉模块」（视觉上可独立识别的功能区域），二者缺一不可。

何时必须拆分为独立 comRef（满足以下任一条件时必须拆出）：
1. 【复用性】该区块会被多个父组件引用，或预期将被复用；
2. 【状态独立性】该区块有自己独立的状态逻辑，与父组件状态解耦，或需要独立订阅 store；
3. 【逻辑复杂度】该区块包含较多交互逻辑、副作用或条件分支，放在父组件内会使父组件臃肿难以维护；
4. 【视觉模块边界】该区块是视觉上清晰可识别的独立功能模块（如筛选栏、数据表格、详情面板、图表区、分页器等），且其内部有一定的 JSX 结构（子节点 ≥ 3 个或存在可命名子结构）；
5. 【列表单项】列表/网格中结构复杂的单项（多于 2 个字段或有交互）；

何时不应拆分（满足以下情况时，无需强行拆分，可在父组件中内联）：
1. 结构极简：仅包含标题文字、单行描述、单个图标等少量元素（子节点 ≤ 2 个），且无独立状态或交互；
2. 无复用价值：仅在当前组件使用一次，且内容简单（如 header 中只有一个标题 \`<h2>标题</h2>\`）；
3. 强依赖上下文：该部分与父组件逻辑深度耦合，拆出后必须靠大量 props 传递才能工作，反而增加复杂度；
- 反例（不应拆分）：页面顶部仅有标题的 header，如 \`<div className={css.header}><h2>用户管理</h2></div>\`，无需拆为独立 Header 组件；

文件位置决策：
- 跨页面复用 → 放入 \`components/组件名/\`；
- 仅当前页面使用 → 放入当前页面目录下（如 \`pages/UserPage/FilterBar/\` 或 \`pages/UserPage/FilterBar.jsx\`）；
- 禁止将只在单一页面使用的简单组件提升到顶层 \`components/\` 目录；

重复结构处理：当一个区块内存在多个「结构相同、仅数据不同」的重复单元时，必须拆成「容器 + 单项」两层：
- 容器（comRef）：负责布局与数据遍历，用 map 渲染单项；
- 单项（comRef）：描述单条数据的 UI，通过 props 接收单条数据；
- 禁止在容器中直接内联重复的 JSX 块；

命名与实现：
- 命名：使用语义化 PascalCase，名称应直接反映其在页面中的位置与职责；
- 实现：每个独立区块写成 \`const 区块名 = comRef(...)\`；
- 区块独立性：父组件只负责布局与子区块挂载，不向子区块传递 value、onChange、onClick 等受控属性；子区块自行从 store 读数据并调用 store 方法；

典型拆分示例（以「用户管理页」为例，筛选栏和列表有独立逻辑，header 只有标题则内联不拆）：
- App
  - Routes
    - UserPage（header 仅含标题，直接内联在页面组件中，不单独拆文件）
      - FilterBar（有筛选状态 → 独立 comRef）
      - UserList（有列表数据与分页 → 独立 comRef）
        - UserRow（列表单项含多字段与操作 → 独立 comRef）
      - EditModal（修改数据弹窗）

#### 文档同步规范

**README.md — 模块说明文档**

节点顺序与类型：
- 按「在 JSX 中依赖顺序」依次写出所有节点，层级用标题级别表示；
- appRef 应用节点、通过 Route 注册的 comRef 组件视为页面节点（page）、未通过 Route 注册的 comRef 视为组件节点（com）；
- 根节点对应 export default ...，文档中根节点标题固定为「# default」；

标题层级规则（全文最多三级）：
- 若同时存在 app、page、com：app 对应一级（# default）、page 对应二级（##）、com 对应三级（###）；
- 若仅有 page 与 com：page 对应一级（# default）、com 对应二级（##）；
- 若仅有 app 与 page 或单层类型，则按实际层级依次使用 ##、###，层级连续且不超过三级；
- 标题内容对应代码中各节点变量声明的变量名；
- 必须按层级关系书写，子节点紧跟在父节点之后，不能将同级标题集中写在前面。例如有 page1（含 com1、com2）和 page2（含 com1、com2）时，正确顺序为：## page1 → ### com1 → ### com2 → ## page2 → ### com1 → ### com2；

每个节点必须包含的字段：
- title：根据节点内容与名称写出简洁的语义化标题，体现节点职责，避免与组件名简单重复（如组件叫 SignIn 时 title 可用「登录页」而非「登录」）；
- summary：对节点的用途、场景或关键行为做简短说明，补充 title 未涵盖的信息，避免与 title 重复或仅罗列 UI 元素；
- type：app | page | com；
- events（该节点有事件时必填，无事件可省略）：
  - 从源码 JSX 块注释中识别，如 /** onClick:事件名 */（或其它 onXXX:事件名）；
  - 每条事件的格式：
    - 事件名
      - title: 简短中文说明（如 登录）
      - mermaid: 流程图（以 flowchart LR; 开头，单行书写，覆盖全链路）
      - relation（仅涉及打开弹窗或跳转页面时填写，只有一条）:
        - type: popup（打开弹窗）| page（跳转页面）
        - name: 关联的弹窗或页面的节点名称

Mermaid 流程图规则：
- 流程图方向统一用 LR（从左到右），节点文本全部用双引号包裹；
- 条件判断节点用 {} 包裹，分支标注用 |标注内容| 写在箭头上；
- 【重要】判断节点的分支必须分开写：每个分支单独写一条箭头，用分号分隔。正确示例：B{"是否展开"} -->|是| C["移除"]; B -->|否| D["添加"]。错误示例：B{"是否展开"} -->|是| C["移除"] -->|否| D["添加"]（这样会把「否」错误地连成 C→D，而不是 B→D）；
- 每条语句末尾加分号分隔，最后一条语句后不加分号；
- 生成后先自检：检查是否有多余分号、引号是否统一、节点连接是否完整（无断链、无悬空节点）、每个判断分支是否都从判断节点单独引出；
- 流程图需覆盖全链路：事件处理与 store 方法内部均需展开，从触发到结束完整呈现；
- 禁止出现「调用 XX API」「调用 XX 函数」等无意义节点，所有 API 及函数调用均须展开其内部逻辑；
- 流程图节点用动作描述，不写具体取值：例如用「设置loading状态」「取消loading状态」，禁止「设置loading为true」；
- 禁止出现用户动作类流程节点（如「点击按钮」）、空洞节点（如「开始」「结束」「执行业务操作」）；
- 分支流程必须完整表达：代码中的 if/else、三元判断、early return、请求成功/失败等所有分支，都必须用条件节点 {} 和 |分支标注| 画出，不得只写主流程而省略条件分支；

更新时机：
- 必须更新（强约束）：目录下不存在 README.md；或现有文档内容与上述规范不符；或需求明确要求更新文档；
- 建议更新（结构或内容变化）：在 jsx 中新增、删除或重命名了 appRef/comRef 节点，或 Route 中注册的页面组件发生变化；export default 的根节点类型或子节点类型组合发生变化导致标题层级需调整；JSX 中新增、删除或修改了带 /** onXXX:事件名 */ 注释的事件；某节点的 UI 结构、交互或业务含义发生明显变化；
- 无需更新：jsx、store.js 未被修改，且现有 README.md 已正确反映当前源码的节点结构、事件与说明；仅修改了 style.less、service.js 等与节点行为无关的文件；

**requirement.md — 需求文档**

书写规范：
- 总体原则：从产品视角梳理，关注整体业务流程、业务规则、效果、业务逻辑和目标；永远不要将源代码中冗余详细的前端信息写进 requirement.md，这是需求文档，不是代码文档；
- 文件顶部必须有 YAML front matter（用 --- 包裹），包含：
  - title：项目标题
  - desc：项目的一句话描述
- 一级标题「# 一、需求背景」：包含背景、目标、流程图、文字描述等，不要过于详细，但需要能够展示清楚内容；
- 一级标题「# 二、需求概述」：按照模块对需求进行拆分，展示一个表格，表头为需求、说明、优先级三列；
- 一级标题「# 三、需求详情」：按照功能点列表详细描述，每一个功能需要声明 type（new / edit）、涉及到的组件 related、优先级 rank（P0–P5），同时需要声明序号；内容可以包含文本、列表、流程图、表格等；
- 一级标题「# 四、数据需求」（可选）：提供对数据指标的定义、埋点和监控需求，一般用表格展示；
- 注意：流程图语法无需包裹在代码块中；

更新时机：
- 必须更新（强约束）：目录下不存在 requirement.md；或需求明确要求更新文档；
- 建议更新：用户的需求目的有更新；源代码关联组件名发生了变化；
`;

    return [
      '# 项目空间\n',
      projectSpaceDesc,
      '\n## 开发指南\n',
      '\n### 项目架构\n',
      architectureContent,
      '\n### 最佳实践\n',
      bestPracticesContent,
      '\n### 允许使用的类库\n',
      '\n---\n\n',
      libraryDocsContent,
      '\n\n---\n\n',
      '\n',
      ...fileSectionParts,
    ].join('');
  }

}

/**
 * 创建 Project 实例
 */
export function createProject(config: ProjectConfig): Project {
  return new Project(config);
}

export { buildProjectJson, defaultRoot } from './buildJson';
export default Project;
