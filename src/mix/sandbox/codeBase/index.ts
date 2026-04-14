import { getEffectiveLibraryDocs } from '../../availableLibraries';

export interface ProjectConfig {
  getFiles: () => any[];
  getThemesContent: () => string;
  getDesignerState?: () => { pages: string[]; popups: string[]; mode?: string } | undefined;
  getErrors?: () => Array<{ message: string; type: string; file?: string }> | undefined;
  getLogs?: () => Array<{ type: string; method: string; args: any[]; timestamp: number; mode?: string }> | undefined;
  snapshotRuntimeMode?: string;
  getFocusInfo?: string;
}

export class Project {
  private config: ProjectConfig;
  private snapshotRuntimeMode: string | undefined;

  constructor(config: ProjectConfig) {
    this.config = config;
    this.snapshotRuntimeMode = config.snapshotRuntimeMode;
  }

  getFocusInfo(): string {
    return this.config.getFocusInfo ?? '';
  }

  hasRuntimeErrors(): boolean {
    const errors = this.config.getErrors?.() ?? [];
    return errors.length > 0;
  }

  exportLogsToMessage(maxCount = 30, maxArgLength = 50): string {
    const allLogs = this.config.getLogs?.() ?? [];
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
`;
    return [
      '# 设计器状态（实时更新）',
      '由于当前在MyBricks设计器中进行搭建和开发，设计器会区分「设计态」和「运行态」，两种模式下展示的内容不一样',
      designModeKnowledge,
      curStatus
    ].join('\n');
  }

  async exportToMessage(): Promise<string> {
    const { getFiles, getThemesContent } = this.config;
    const promptSections = (window as any)._sandbox_?.config?.promptSections;
    const developeGuide = promptSections?.developeGuide ?? {};
    const designGuide = promptSections?.designGuide ?? {};

    const bestPracticesContent = [
      '#### 资源使用：\n' + developeGuide.assetsUsageSection,
    ].filter(Boolean).join('\n');

    const architectureContent = developeGuide.architectureSection ?? '';

    const themesContent = getThemesContent();
    const designContent = [
      designGuide.firstOfAll,
      themesContent,
    ].filter(Boolean).join('\n');

    const projectSpaceDesc = `这是组成整个页面的仓库和源代码。
注意：除了获取/修改代码的情况，不要告知用户有这个架构、工具、文件系统的存在，用户不是专业开发者，不懂这些信息。`;

    const libraryDocsContent = getEffectiveLibraryDocs();
    const fileSectionParts: string[] = [];

    fileSectionParts.push('\n## 源代码\n');
    fileSectionParts.push('包含项目中的各代码文件。\n');

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
      '\n# 开发指南\n',
      developeGuide.firstOfAll,
      '\n## 项目架构\n',
      architectureContent,
      '\n## 最佳实践\n',
      bestPracticesContent,
      developeGuide.extraSection,
      '\n## 设计规范\n',
      designContent,
      '\n## 允许使用的类库\n',
      '\n---\n\n',
      libraryDocsContent,
      '\n\n---\n\n',
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
