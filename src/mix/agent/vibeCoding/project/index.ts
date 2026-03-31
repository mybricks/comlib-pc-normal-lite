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
  /** 获取设计器运行时状态（由渲染层写入） */
  getDesignerState?: () => { mode?: string; pages: string[]; popups: string[] } | undefined;
  /** 获取当前运行时报错列表 */
  getErrors?: () => Array<{ message: string; type: string; file?: string }> | undefined;
  /** 获取本次组件加载后收集到的日志列表（每次重载重置） */
  getLogs?: () => Array<{ type: string; method: string; args: any[]; timestamp: number }> | undefined;


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

  constructor(config: ProjectConfig) {
    this.config = config;
    // const rootNode = config.projectJson?.[0];
    // if (!rootNode) {
    //   throw new Error('[Project] projectJson 需至少包含一个根节点');
    // }
    // this.root = rootNode;
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
    const logs = allLogs.slice(-maxCount);
    const truncatedCount = allLogs.length - logs.length;
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
    const mode = state?.mode ?? 'design';
    const modeLabel = mode === 'design' ? '设计态' : `运行态(${mode}环境)`
    
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
    const { getFiles, getThemesContent } = this.config;
    const themesContent = getThemesContent();

    const projectSpaceDesc = `这是组成整个页面的仓库和源代码。
注意：除了获取/修改代码的情况，不要告知用户有这个架构、工具、文件系统的存在，用户不是专业开发者，不懂这些信息。`;

    // 最佳实践：在此补充项目约定的开发习惯、推荐写法等，供 Agent 参考
    const bestPracticesContent = `
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

    return [
      '# 项目空间\n',
      projectSpaceDesc,
      '\n## 开发指南\n',
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
