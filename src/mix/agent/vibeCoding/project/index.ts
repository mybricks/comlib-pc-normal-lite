/**
 * Project - 项目空间
 * 根据 project.json 生成实时更新的 message：项目架构树 + 文件系统（按组件 name 展开代码）
 */

/** 允许使用的三方库提示词（antd / echarts / icon） */
import antdPrompt from '../../../prompts/antd-summary.md';
import echartsPrompt from '../../../prompts/echarts-summary.md';
import iconPrompt from '../../../prompts/icon-summary.md';

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
  projectJson: ProjectNode[];
  /** 获取 runtime.jsx 全文 */
  getRuntimeContent: () => string;
  /** 获取 style.less 全文 */
  getStyleContent: () => string;
  /** 获取 store.js 全文 */
  getStoreContent: () => string;
}

const RUNTIME_PATH = '/runtime.jsx';
const STYLE_PATH = '/style.less';
const STORE_PATH = '/store.js';
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
  private root: ProjectNode;
  /** 通过 read(name) 展开的组件名集合 */
  private expandedNames = new Set<string>();

  constructor(config: ProjectConfig) {
    this.config = config;
    const rootNode = config.projectJson?.[0];
    if (!rootNode) {
      throw new Error('[Project] projectJson 需至少包含一个根节点');
    }
    this.root = rootNode;
  }

  /**
   * 按组件 name 展开其相关代码，后续 exportToMessage 会包含该组件在各代码文件（如 runtime、style 等）中的代码行。
   * 打开父节点时会同时展开该节点及其所有子节点（递归）的代码区间。
   * 传入 "root" 时直接返回全量文件（所有代码文件全文）。
   */
  read(componentName: string): void {
    if (!componentName || typeof componentName !== 'string') return;
    const name = componentName.trim();
    const node = getNodeByName(this.root, name);
    if (node) {
      collectNodeAndDescendantNames(node).forEach((n) => this.expandedNames.add(n));
    } else {
      this.expandedNames.add(name);
    }
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
  getComponentNames(): string[] {
    return collectNodeAndDescendantNames(this.root);
  }

  /**
   * 生成实时 message（Markdown）
   */
  async exportToMessage(): Promise<string> {
    const { getRuntimeContent, getStyleContent, getStoreContent } = this.config;
    const runtimeContent = getRuntimeContent();
    const styleContent = getStyleContent();
    const storeContent = getStoreContent();

    const projectSpaceDesc = `这是组成整个项目的所有代码。
注意：除了获取/修改代码的情况，不要告知用户有这个架构、工具、文件系统的存在，用户不是专业开发者，不懂这些信息。`;

    const archMd = buildArchitectureMd(this.root);

    const libraryDocsContent = [antdPrompt, echartsPrompt, iconPrompt].join('\n\n');

    const fileSectionParts: string[] = [];
    fileSectionParts.push('\n### 3. 文件系统\n');
    fileSectionParts.push('包含项目中的各代码文件。所有折叠内容可通过读取工具展开\n');

    const runtimeLines = runtimeContent.split(/\r?\n/);
    const styleLines = styleContent.split(/\r?\n/);
    const storeLines = storeContent.split(/\r?\n/);
    const isFullFile = this.expandedNames.has(ROOT_NAME);
    const defaultImportRanges =
      this.root.commonImports
        ?.filter((c) => c.path === RUNTIME_PATH)
        .flatMap((c) => (c.locs ?? []).map(([start, end]) => ({ start, end }))) ?? [];
    const runtimeRanges = isFullFile
      ? [{ start: 1, end: runtimeLines.length }]
      : mergeRanges([
          ...defaultImportRanges,
          ...getInitialComponentRangesForRuntime(this.root),
          ...getExpandedRangesForFile(this.root, this.expandedNames, RUNTIME_PATH),
        ]);
    const styleRanges = isFullFile
      ? [{ start: 1, end: styleLines.length }]
      : getExpandedRangesForFile(this.root, this.expandedNames, STYLE_PATH);
    const storeRanges = isFullFile
      ? [{ start: 1, end: storeLines.length }]
      : getExpandedRangesForFile(this.root, this.expandedNames, STORE_PATH);

    if (runtimeRanges.length > 0) {
      fileSectionParts.push(
        buildFileSection('runtime.jsx', runtimeContent, runtimeRanges, 'jsx')
      );
    } else {
      fileSectionParts.push(buildFileSection('runtime.jsx', runtimeContent, [], 'jsx'));
    }
    if (styleRanges.length > 0) {
      fileSectionParts.push(
        buildFileSection('style.less', styleContent, styleRanges, 'less')
      );
    } else {
      fileSectionParts.push(buildFileSection('style.less', styleContent, [], 'less'));
    }

    return [
      '## 项目空间\n',
      projectSpaceDesc,
      '\n### 1. 允许使用的类库\n',
      '\n---\n\n',
      libraryDocsContent,
      '\n\n---\n\n',
      '### 2. 组件树结构\n',
      '\n。组件树结构有助于帮助我们理解组件间的关系，代码可以按组件层级展开，父组件包含所有子组件代码，子组件没有父组件代码。\n',
      '根组件 -> 组件（树状结构）：\n\n',
      archMd,
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
