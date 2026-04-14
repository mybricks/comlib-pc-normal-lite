/**
 * mix sandbox adapter
 *
 * 实现 plugin-ai 的 Designer + Hooks 接口，通过 window._sandbox_.connectToAI 注册。
 *
 * 核心设计：
 * - project 实例在 hooks.beforeRequest 中创建（快照当前 runtimeMode），
 *   每次请求都会重建，确保 exportDesignerToMessage / exportLogsToMessage
 *   读取到请求发起时刻的正确状态。
 * - Designer 方法通过 projectRef.current 访问当前快照的 project 实例。
 */

import context from '../context';
import { debugLogs } from '../context/debugLogs';
import { createProject } from './codeBase';
import { updateComponentFiles } from '../agent/vibeCoding/tools/utils/files';
import { uuid } from '../../utils';

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
    getDesignerState: () => aiComParams?.data?._designerState,
    getErrors: () => aiComParams?.data?._errors,
    getLogs: () => debugLogs.get(comId),
    snapshotRuntimeMode: aiComParams?.data?.runtimeMode,
  });
}

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface VersionFile {
  path: string;
  content: string;
}

interface VersionRecord {
  id: string;
  turnId: string;
  label: string;
  type: 'ai' | 'manual' | 'rollback';
  createdAt: number;
  summary?: string;
}

// ─── 设计器 loading / lock（与 vibeCoding 请求进度一致）────────────────────────

// export type DesignerLoadingProgressStatus = 'start' | 'complete' | 'error';

// export interface DesignerLoadingOptions {
//   /** 与 plugin-ai request params.onProgress 对齐 */
//   onProgress?: (status: DesignerLoadingProgressStatus) => void;
// }

// /**
//  * 单次 AI 请求内的 lock + 编译/运行时错误监听 + onProgress 回调。
//  * registerSandbox 里 designer.loading(...) 与 vibeCoding 共用此实现。
//  */
// export function createDesignerLoading(
//   comId: string,
//   focusArea: any,
//   options?: DesignerLoadingOptions
// ) {
//   const lockId = uuid();
//   let compileError: any = null;
//   let runtimeError: any = null;

//   const events = context.getAiComEvents(comId);
//   const offCompileError = events.on('compileError', (error) => {
//     compileError = error?.length ? error : null;
//   });
//   const offRuntimeError = events.on('runtimeError', (error) => {
//     runtimeError = error;
//   });

//   let lockType: 'lock' | 'unlock' | undefined;
//   const { actions } = context.getAiCom(comId);

//   const setLock = (type: 'lock' | 'unlock') => {
//     if (lockType === type) {
//       return;
//     }
//     lockType = type;
//     if (!focusArea || compileError || runtimeError) {
//       options?.onProgress?.(type === 'lock' ? 'start' : 'complete');
//     } else {
//       actions[type](lockId, focusArea);
//     }
//   };

//   const onProgress = (status: DesignerLoadingProgressStatus) => {
//     if (status === 'start') {
//       (window as any).__vibeCodingCallbacks__?.onStart?.();
//       setLock('lock');
//     } else if (status === 'complete') {
//       (window as any).__vibeCodingCallbacks__?.onComplete?.();
//       setLock('unlock');
//       offCompileError();
//       offRuntimeError();
//     } else if (status === 'error') {
//       (window as any).__vibeCodingCallbacks__?.onError?.();
//       setLock('unlock');
//       offCompileError();
//       offRuntimeError();
//     }
//   };

//   const dispose = () => {
//     offCompileError();
//     offRuntimeError();
//   };

//   return { onProgress, setLock, dispose };
// }

// ─── 注册沙箱 ─────────────────────────────────────────────────────────────────

/**
 * 注册组件沙箱到 plugin-ai。
 * 在 editors/index.tsx 中 context.setAiCom 之后调用。
 */
export function registerSandbox(comId: string): void {
  const connectToAI = (window as any)._sandbox_?.connectToAI;
  if (typeof connectToAI !== 'function') {
    console.warn('[mix/sandbox] window._sandbox_.connectToAI not found, skipping sandbox registration');
    return;
  }

  const projectRef = getProjectRef(comId);
  const { history } = connectToAI(comId, {
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

      // /**
      //  * 与 vibeCoding 请求相同的 loading控制器；focusArea 无选区时走 params.onProgress。
      //  */
      // loading(focusArea: any, opts?: DesignerLoadingOptions) {
      //   return createDesignerLoading(comId, focusArea, opts);
      // },
    },

    hooks: {
      async beforeRequest() {
        // projectRef.current = buildProject(comId);
      },
      async beforeTurn() {
        projectRef.current = buildProject(comId);
        const data = context.getAiComParams(comId)?.data;
        if (data && typeof data === 'object') {
          requestSourceSnapshotMap.set(data, createSourceSnapshot(data.files ?? []));
        }
      },
      async afterTurn(turn: { id?: string }) {
        if (!history) return;
        const data = context.getAiComParams(comId)?.data;
        if (!data || typeof data !== 'object') return;

        const previousSnapshot = requestSourceSnapshotMap.get(data);
        if (!hasSourceChanged(data.files ?? [], previousSnapshot)) return;

        // 构建文件快照（只存 decoded source）
        const files: VersionFile[] = (data.files ?? [])
          .filter((f: any) => f.source)
          .map((f: any) => ({
            path: f.fileName,
            content: decodeURIComponent(f.source),
          }));

        // 版本序号：读取现有版本数量
        const existingVersions = await history.listVersions();

        // 幂等保护：同一 turnId 不重复创建版本
        if (turn?.id && existingVersions.some((v: VersionRecord) => v.turnId === turn.id)) return;

        const record: VersionRecord = {
          id: crypto.randomUUID(),
          turnId: turn?.id ?? '',
          label: `V${existingVersions.length}`,
          type: 'ai',
          createdAt: Date.now(),
        };

        await history.addVersion(record, files);

        // 通知 UI
        const updated = await history.listVersions();
        context.notifyVersionsChange(comId, updated);
      },
      async afterTurnSummary(turn: { id?: string }, summary: string) {
        if (!history || !turn?.id) return;

        const versions = await history.listVersions();
        const target = versions.find((v: VersionRecord) => v.turnId === turn.id);
        if (!target) return;

        await history.updateVersion(target.id, { summary });

        // 通知 UI
        const updated = await history.listVersions();
        context.notifyVersionsChange(comId, updated);
      },
    },
  }) ?? {};

  // ── rollback 方法，挂到 context 供版本面板 UI 调用 ──────────────────────────

  async function rollbackToVersion(versionId: string): Promise<void> {
    if (!history) return;

    // 1. 读出目标版本的文件
    const [targetMeta, files] = await Promise.all([
      history.getVersion(versionId),
      history.getVersionFiles(versionId),
    ]);
    if (!targetMeta || !files.length) return;

    // 2. 恢复文件到当前 data（触发重新编译）
    for (const file of files) {
      context.updateFile(comId, { fileName: file.path, content: file.content });
    }

    // 3. 新增一条 rollback 类型版本记录
    const existingVersions = await history.listVersions();
    const rollbackRecord: VersionRecord = {
      id: crypto.randomUUID(),
      turnId: targetMeta.turnId,
      label: `V${existingVersions.length}`,
      type: 'rollback',
      createdAt: Date.now(),
      summary: `回滚自 ${targetMeta.label}`,
    };
    await history.addVersion(rollbackRecord, files);

    // 4. 通知 UI
    const updated = await history.listVersions();
    context.notifyVersionsChange(comId, updated);

    // 5. 触发保存（保持与原逻辑一致）
    (window as any)._mybricksOnEdit_?.({ autoSave: true });
  }

  (context as any).setRollback(comId, rollbackToVersion);
  (context as any).setHistory(comId, history);
}
