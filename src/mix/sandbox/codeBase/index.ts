import { getEffectiveLibraries, type EffectiveLibrary } from '../../availableLibraries';
import { FileSystem } from "../../../utils/ai-code/render/next-runtime/utils";
import { extractMissingFiles } from "../../../utils/ai-code/render/next-runtime/utils"
import type { LintMessage } from '../../eslint';
import type { LogEntry } from '../../context/debugLogs';
import { formatRuntimeModeLabel, parseRuntimeMode } from '../../../utils/ai-code/runtimeMode';

type LogListQuery = {
  page?: number;
  pageSize?: number;
  like?: Record<string, string>;
};

type LogListItem = {
  id: string;
  level: string;
  timestamp: number;
  mode?: string;
  runtime?: string;
  [key: string]: any;
};

type LogListResult = {
  total: number;
  page: number;
  pageSize: number;
  items: LogListItem[];
};

type LogDetail = LogListItem & {
  args: any[];
  result?: any;
};

export interface ProjectConfig {
  getFiles: () => any[];
  getDesignerState?: () => { pages: Array<{ name: string; visible: boolean }>; popups: Array<{ name: string; visible: boolean }> } | undefined;
  getErrors?: () => Array<{ message: string; type: string; file?: string }> | undefined;
  getLogs?: () => LogEntry[] | undefined;
  getRuntimeMode?: () => string | undefined;
  getFocusInfo?: string;
  getFileSystem?: () => FileSystem;
  getLintResults?: () => Promise<LintMessage[]>;
}

export class Project {
  private config: ProjectConfig;

  constructor(config: ProjectConfig) {
    this.config = config;
  }

  getFocusInfo(): string {
    return this.config.getFocusInfo ?? '';
  }

  hasRuntimeErrors(): boolean {
    const errors = this.config.getErrors?.() ?? [];
    return errors.length > 0;
  }

  private getCurrentLogs(): LogEntry[] {
    const allLogs = this.config.getLogs?.() ?? [];
    const runtimeMode = this.config.getRuntimeMode?.();
    const logs = runtimeMode
      ? allLogs.filter((entry) => entry.mode === runtimeMode)
      : allLogs;

    return logs.filter((entry) => entry.type === 'logger');
  }

  private getLogFieldValue(entry: LogEntry, field: string): string {
    if (field === 'runtime') {
      return String(entry.bindings?.runtime ?? '');
    }

    if (field === 'level') {
      return entry.method;
    }

    if (entry.bindings && field in entry.bindings) {
      return String(entry.bindings[field] ?? '');
    }

    const value = field.split('.').reduce((current: any, key) => {
      if (key === 'message') {
        return entry.args;
      }
      return current?.[key];
    }, entry as any);

    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  getLogList(query: LogListQuery = {}): LogListResult {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const like = query.like ?? {};
    const logs = this.getCurrentLogs().filter((entry) => {
      return Object.entries(like).every(([field, keyword]) => {
        if (!keyword) return true;
        return this.getLogFieldValue(entry, field).toLowerCase().includes(String(keyword).toLowerCase());
      });
    });
    const start = (page - 1) * pageSize;
    const items = logs.slice(start, start + pageSize).map((entry) => {
      const { id, type, method, timestamp, mode, bindings } = entry;
      const { runtime, ...restBindings } = bindings ?? {};

      return {
        id,
        level: method,
        timestamp,
        mode,
        runtime,
        ...restBindings,
      };
    });

    return {
      total: logs.length,
      page,
      pageSize,
      items,
    };
  }

  getLogDetail(id: string): LogDetail | undefined {
    const entry = this.getCurrentLogs().find((entry) => entry.id === id);

    if (!entry) {
      return undefined;
    }

    const { method, bindings, args, result, timestamp, mode } = entry;
    const { runtime, ...restBindings } = bindings ?? {};

    return {
      id: entry.id,
      level: method,
      timestamp,
      mode,
      runtime,
      ...restBindings,
      args,
      result,
    } as LogDetail;
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
    const runtimeMode = this.config.getRuntimeMode?.();
    const runtimeModeInfo = parseRuntimeMode(runtimeMode);
    const modeLabel = formatRuntimeModeLabel(runtimeMode);
    const dataEnvLine = runtimeModeInfo.viewMode === 'runtime' && runtimeModeInfo.dataEnv
      ? `数据环境：${runtimeModeInfo.dataEnv}`
      : '';

    const pageRefNames = state?.pages ?? [];
    const popupRefNames = state?.popups ?? [];

    const errors = this.config.getErrors?.() ?? [];

    let canvasStatus: string;
    if (errors.length > 0) {
      const errorLines = errors.map((e, i) => {
        if (e instanceof Error) {
          return `  ${i + 1}. [${'runtime'}]: ${e?.message}，以下是错误堆栈信息：\n${e?.stack?.split("\n").slice(0, 2).join("\n")}`
        }
        return `  ${i + 1}. [${e.type}]${e.file ? ` ${e.file}` : ''}: ${e.message}`
      }).join('\n');
      canvasStatus = `画布当前处于报错状态，暂时无法看见任何展示内容。错误列表如下：\n${errorLines}`;
    } else if (pageRefNames.length === 0 && popupRefNames.length === 0) {
      canvasStatus = '当前代码暂无页面或弹窗组件，画布尚无可展示内容。';
    } else {
      const allZones = [
        ...pageRefNames.map(({ name, visible }) => ({ name, kind: '页面', visible })),
        ...popupRefNames.map(({ name, visible }) => ({
          name,
          kind: '弹窗/浮层',
          visible,
        })),
      ];
      let unvisibleCount = 0
      const zonesList = allZones.map((z, i) => {
        if (z.kind === '弹窗/浮层') {
          if (!z.visible) {
            unvisibleCount = unvisibleCount + 1
          }
          const visibilityNote = z.visible
            ? '当前已展示（可见）'
            : '当前未展示（不可见，弹窗/浮层可能尚未被触发或已关闭）';
          return `  ${i + 1}. ${z.name}（${z.kind}，${visibilityNote}）`;
        }
        return `  ${i + 1}. ${z.name}（${z.kind}）`;
      }).join('\n');
      canvasStatus = `画布从左到右共渲染了 ${allZones.length} 个画布（页面 ${pageRefNames.length} 个，弹窗/浮层 ${popupRefNames.length} 个），依次为：
${zonesList}${unvisibleCount ? `
当前有 ${unvisibleCount} 个弹窗/浮层不可见，需要检查代码并修复
  ` : ''}`;
    }

    const curStatus = `
## 当前状态
状态：${modeLabel}
${dataEnvLine ? `${dataEnvLine}\n` : ''}

## 设计态渲染情况
${canvasStatus}
`;

    let emptyFiles = ''
    const fileSystem = this.config.getFileSystem?.()
    if (fileSystem?.tempFilesMap) {   
      const { tempFilesMap } = fileSystem
      const missingFiles = extractMissingFiles(tempFilesMap)
      const missingFilesEntries = Object.entries(missingFiles)

      if (missingFilesEntries.length > 0) {
        emptyFiles = `
# 文件引用检查

当前有 ${missingFilesEntries.length} 个文件的相对引用无法解析，导致部分内容无法渲染：

${missingFilesEntries.map(([file, info], index) => {
  const dependents = Array.from(info.dependedBy).join('、')
  return `${index + 1}. ${dependents} 导入了不存在的路径 ${file}${info.isEntry ? '（入口文件）' : ''}，请检查相对路径是否有误，或缺失该文件`
}).join('\n')}
`
      }
    }

    let lintMessages: import('../../eslint').LintMessage[] = [];
    try {
      lintMessages = await (this.config.getLintResults?.() ?? Promise.resolve([]));
    } catch {
      lintMessages = [];
    }
    let lintSection = '';
    if (lintMessages.length > 0) {
      const lines = lintMessages.map((msg, i) => {
        const severity = msg.severity === 2 ? 'error' : 'warn';
        const loc = msg.line > 0 ? `${msg.fileName ?? ''}:${msg.line}:${msg.column}` : (msg.fileName ?? '');
        return `  ${i + 1}. [${severity}] ${loc} ${msg.message}`;
      }).join('\n');
      lintSection = `\n# 代码检查信息\n共 ${lintMessages.length} 个问题，必须自动修复：\n${lines}\n`;
    } else {
      lintSection = '\n# 代码检查信息\n暂未发现代码问题。\n';
    }

    return [
      '# 渲染状态',
      '由于当前在MyBricks设计器中进行搭建和开发，设计器会区分「设计态」和「运行态」，两种模式下展示的内容不一样。',
      '模式切换由用户自己在页面上方进行切换，如有必要切换来获取信息，可以让用户手动切换一下。',
      designModeKnowledge,
      curStatus,
      lintSection,
      emptyFiles
    ].join('\n');
  }

  getEffectiveLibraries(): EffectiveLibrary[] {
    return getEffectiveLibraries();
  }

  async exportResourceCode(): Promise<string> {
    const { getFiles } = this.config;

    const fileSectionParts: string[] = [];

    fileSectionParts.push('\n## 源代码\n');
    fileSectionParts.push('包含项目中的各代码文件，所有内容每一轮都实时更新，无需读取这些文件，前面步骤的的所有代码操作如果成功了也会反应到这里，不要质疑之前的操作。\n');

    const projectSpaceDesc = `这是组成整个页面的仓库和源代码，所有内容每一轮都实时更新，无需读取这些文件。
注意：除了获取/修改代码的情况，不要告知用户有这个架构、工具、文件系统的存在，用户不是专业开发者，不懂这些信息。`;

    const files = getFiles();
    if (files.length === 0) {
      fileSectionParts.push('这是一个空项目，没有任何代码文件。\n');
    } else {
      files.forEach((file) => {
        const { fileName, source } = file;
        const content = decodeURIComponent(source);
        const suffix = fileName.split('.').pop() ?? '';
        fileSectionParts.push(`\n#### ${fileName}\n\n\`\`\`${suffix}\n${content}\n\`\`\`\n`);
      });
    }

    return [
      '# 项目空间\n',
      projectSpaceDesc,
      '\n',
      ...fileSectionParts,
    ].join('');
  }
}

export function createProject(config: ProjectConfig): Project {
  return new Project(config);
}

export default Project;
