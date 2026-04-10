/**
 * mix sandbox adapter
 *
 * 实现 plugin-ai 的 Designer + Hooks 接口，通过 window._registSandBox_ 注册。
 *
 * 核心设计：
 * - project 实例在 hooks.beforeRequest 中创建（快照当前 runtimeMode），
 *   每次请求都会重建，确保 exportDesignerToMessage / exportLogsToMessage
 *   读取到请求发起时刻的正确状态。
 * - Designer 方法通过 projectRef.current 访问当前快照的 project 实例。
 */

import context from '../context';
import { debugLogs } from '../context/debugLogs';
import { createProject } from '../agent/vibeCoding/project';
import { updateComponentFiles } from '../agent/vibeCoding/tools/utils/files';

// ─── 内部状态 ─────────────────────────────────────────────────────────────────

/**
 * 每个 comId 对应一个 projectRef，在 beforeRequest 时更新。
 * 初始为 undefined，首次请求前必须通过 beforeRequest 完成初始化。
 */
const projectRefMap = new Map<string, { current: ReturnType<typeof createProject> | undefined }>();
const requestSourceSnapshotMap = new WeakMap<object, Map<string, string>>();

function getProjectRef(comId: string) {
  if (!projectRefMap.has(comId)) {
    projectRefMap.set(comId, { current: undefined });
  }
  return projectRefMap.get(comId)!;
}

function createSourceSnapshot(files: any[]): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const file of files ?? []) {
    const fileName = typeof file?.fileName === 'string' ? file.fileName : '';
    const source = typeof file?.source === 'string' ? file.source : '';
    snapshot.set(fileName, source);
  }
  return snapshot;
}

function hasSourceChanged(files: any[], previousSnapshot?: Map<string, string>): boolean {
  if (!previousSnapshot) return false;
  if (previousSnapshot.size !== (files?.length ?? 0)) return true;

  for (const file of files ?? []) {
    const fileName = typeof file?.fileName === 'string' ? file.fileName : '';
    const source = typeof file?.source === 'string' ? file.source : '';
    if (!previousSnapshot.has(fileName) || previousSnapshot.get(fileName) !== source) {
      return true;
    }
  }

  return false;
}

// ─── 构建 project 快照 ────────────────────────────────────────────────────────

function buildProject(comId: string) {
  const aiComParams = context.getAiComParams(comId);

  const themesContent = (() => {
    try {
      const theme = context.resolveActiveTheme(aiComParams?.data);
      return (
        '- 设计风格：' +
        (theme?.vars?.length
          ? '\n  ui设计参考以下主题变量，css变量已经自动注入页面，直接使用变量即可，禁止重复定义。' +
            theme.vars.reduce((pre: string, cur: any) => {
              return (
                pre +
                `\n  - ${cur.title}： ${cur.propertyName}: ${cur.value}${cur.desc ? ` [${cur.desc}]` : ''}`
              );
            }, '')
          : '\n  当前项目没有定义主题变量，禁止创造变量，风格根据需求自由发挥即可')
      );
    } catch {
      return '';
    }
  })();

  return createProject({
    getFiles: () => aiComParams?.data?.files ?? [],
    getThemesContent: () => themesContent,
    getCodeRules: () => context.projectConfig.codeRules ?? '',
    getDesignRules: () => context.projectConfig.designRules ?? '',
    getDesignerState: () => aiComParams?.data?._designerState,
    getErrors: () => aiComParams?.data?._errors,
    getLogs: () => debugLogs.get(comId),
    snapshotRuntimeMode: aiComParams?.data?.runtimeMode,
  });
}

// ─── 注册沙箱 ─────────────────────────────────────────────────────────────────

/**
 * 注册组件沙箱到 plugin-ai。
 * 在 editors/index.tsx 中 context.setAiCom 之后调用。
 */
export function registerSandbox(comId: string): void {
  const registSandBox = (window as any)._registSandBox_;
  if (typeof registSandBox !== 'function') {
    console.warn('[mix/sandbox] window._registSandBox_ not found, skipping sandbox registration');
    return;
  }

  const projectRef = getProjectRef(comId);

  registSandBox(comId, {
    designer: {
      async exportToMessage(): Promise<string> {
        const project = projectRef.current;
        if (!project) return '';
        return project.exportToMessage();
      },

      // ── 文件系统 ──────────────────────────────────────────────────────────

      async getFiles() {
        const aiComParams = context.getAiComParams(comId);
        const files: any[] = aiComParams?.data?.files ?? [];
        return files
          .filter((f) => f.source)
          .map((f) => ({
            path: f.fileName,
            content: decodeURIComponent(f.source),
          }));
      },

      async updateFiles(files: Array<{ path: string; content: string }>) {
        await updateComponentFiles(
          files.map(({ path: fileName, content }) => ({
            fileName,
            content,
            language: 'write',
          })),
          comId,
          context
        );
      },

      async deleteFiles(paths: string[]) {
        await updateComponentFiles(
          paths.map((fileName) => ({
            fileName,
            content: '',
            language: 'delete',
          })),
          comId,
          context
        );
      },

      // ── 设计器状态 ────────────────────────────────────────────────────────

      async exportDesignerToMessage(): Promise<string> {
        const project = projectRef.current;
        if (!project) return '';
        return project.exportDesignerToMessage();
      },

      exportLogsToMessage(): string {
        const project = projectRef.current;
        if (!project) return '';
        return project.exportLogsToMessage();
      },

      getRuntimeMode(): string | undefined {
        return context.getAiComParams(comId)?.data?.runtimeMode;
      },
    },

    hooks: {
      /**
       * 每次 AI 请求前重建 project 快照，锁定当前 runtimeMode。
       * 此后本轮请求的 exportDesignerToMessage / exportLogsToMessage 都基于该快照。
       */
      async beforeRequest() {
        projectRef.current = buildProject(comId);
        const data = context.getAiComParams(comId)?.data;
        if (data && typeof data === 'object') {
          requestSourceSnapshotMap.set(data, createSourceSnapshot(data.files ?? []));
        }
      },
      async afterTurn(turn: { id?: string }) {
        const data = context.getAiComParams(comId)?.data;
        if (!data || typeof data !== 'object') return;

        const previousSnapshot = requestSourceSnapshotMap.get(data);
        if (!hasSourceChanged(data.files ?? [], previousSnapshot)) return;

        if (!turn?.id) {
          await context.addVersion(comId, 'ai');
          return;
        }

        const versions = await context.getVersions(comId);
        if (versions.some((version) => version.planId === turn.id)) return;
        await context.addVersion(comId, 'ai', turn);
      },
      async afterTurnSummary(turn: { id?: string }, summary: string) {
        if (!turn?.id) return;
        await context.updateVersionWithContent(comId, turn, { summary });
      },
    },
  });
}
