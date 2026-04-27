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
import { verify as eslintVerify } from '../eslint';

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

  // const themesContent = (() => {
  //   try {
  //     const theme = context.resolveActiveTheme(aiComParams?.data);
  //     return (
  //       '- 设计风格：' +
  //       (theme?.vars?.length
  //         ? '\n  ui设计参考以下主题变量，css变量已经自动注入页面，直接使用变量即可，禁止重复定义。' +
  //           theme.vars.reduce((pre: string, cur: any) => {
  //             return (
  //               pre +
  //               `\n  - ${cur.title}： ${cur.propertyName}: ${cur.value}${cur.desc ? ` [${cur.desc}]` : ''}`
  //             );
  //           }, '')
  //         : '\n  当前项目没有定义主题变量，禁止创造变量，风格根据需求自由发挥即可')
  //     );
  //   } catch {
  //     return '';
  //   }
  // })();

  let runtimeError: any = null
  const events = context.getAiComEvents(comId);
  events.on('runtimeError', (error) => {
    runtimeError = error
  })

  let fileSystem

  return createProject({
    getFiles: () => aiComParams?.data?.files ?? [],
    getThemesContent: () => "", // themesContent
    getDesignerState: () => aiComParams?.data?._designerState,
    getFileSystem: () => {
      // 获取文件状态，vibing状态下，有部分文件可能还没编写完成
      return context.fileSystemMap[comId]
    },
    getErrors: () => {
      if (!fileSystem) {
        fileSystem = context.fileSystemMap[comId]
      }

      const errors: any[] = [];

      if (fileSystem) {
        errors.push(...fileSystem.getErrors())
      }

      return errors.concat(aiComParams?.data?._errors || [])
    },
    getLogs: () => debugLogs.get(comId),
    snapshotRuntimeMode: aiComParams?.data?.runtimeMode,
    getCodeRules: () => context.projectConfig.codeRules ?? '',
    getDesignRules: () => context.projectConfig.designRules ?? '',
    getLintResults: () => {
      const files: any[] = aiComParams?.data?.files ?? [];
      return eslintVerify(files);
    },
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

type SandboxHistory = {
  listVersions: () => Promise<VersionRecord[]>;
  addVersion: (record: VersionRecord, files: VersionFile[]) => Promise<void>;
};

/**
 * turn 结束后：若源码相对 beforeTurn 快照有变化，则追加一条 AI 版本（含幂等）。
 * 内部可提前 return，不影响调用方后续逻辑。
 */
async function persistAiVersionAfterTurn(
  comId: string,
  history: SandboxHistory,
  data: { files?: any[] },
  turn?: { id?: string }
): Promise<void> {
  const previousSnapshot = requestSourceSnapshotMap.get(data);
  if (!hasSourceChanged(data.files ?? [], previousSnapshot)) return;

  const files: VersionFile[] = (data.files ?? [])
    .filter((f: any) => f.source)
    .map((f: any) => ({
      path: f.fileName,
      content: decodeURIComponent(f.source),
    }));

  const existingVersions = await history.listVersions();

  if (turn?.id && existingVersions.some((v: VersionRecord) => v.turnId === turn.id)) return;

  const record: VersionRecord = {
    id: crypto.randomUUID(),
    turnId: turn?.id ?? '',
    label: `V${existingVersions.length}`,
    type: 'ai',
    createdAt: Date.now(),
  };

  await history.addVersion(record, files);

  const updated = await history.listVersions();
  context.notifyVersionsChange(comId, updated);
}

// ─── 设计器 loading / lock（与 vibeCoding 请求进度一致）────────────────────────

export type DesignerLoadingProgressStatus = 'start' | 'complete' | 'error';

export interface DesignerLoadingOptions {
  /** 与 plugin-ai request params.onProgress 对齐 */
  onProgress?: (status: DesignerLoadingProgressStatus) => void;
}

/**
 * 单次 AI 请求内的 lock + 编译/运行时错误监听 + onProgress 回调。
 * registerSandbox 里 designer.loading(...) 与 vibeCoding 共用此实现。
 */
export function createDesignerLoading(
  comId: string,
  focusArea: any,
  options?: DesignerLoadingOptions
) {
  const lockId = uuid();
  let compileError: any = null;
  let runtimeError: any = null;
  // [TODO] 临时加一个字段，只要报错过就只能 progress 模式，目前报错后focusArea已经丢失
  let hasErrorOccurred: boolean = false;

  const events = context.getAiComEvents(comId);
  const offCompileError = events.on('compileError', (error) => {
    compileError = error?.length ? error : null;

    if (error?.length) {
      hasErrorOccurred = true
    }
  });
  const offRuntimeError = events.on('runtimeError', (error) => {
    runtimeError = error;

    if (error) {
      hasErrorOccurred = true
    }
  });

  const { actions } = context.getAiCom(comId);

  // 当前生效的锁模式：progress = onProgress 整页；component = actions.lock 组件锁；null = 未上锁
  let currentMode: 'progress' | 'component' | null = null;
  let releaseLock: (() => void) | null = null;

  const resolveMode = (): 'progress' | 'component' =>
    !focusArea || compileError || runtimeError || hasErrorOccurred ? 'progress' : 'component';

  const applyLock = (mode: 'progress' | 'component') => {
    if (mode === 'progress') {
      options?.onProgress?.('start');
      releaseLock = () => {
        options?.onProgress?.('complete');
      };
    } else {
      const lockResult = actions.lock(lockId, focusArea);
      releaseLock = typeof lockResult === 'function'
        ? lockResult
        : () => actions.unlock(lockId, focusArea);
    }
    currentMode = mode;
  };

  const releaseCurrent = () => {
    if (releaseLock) {
      releaseLock();
      releaseLock = null;
    }
    currentMode = null;
  };

  const setLock = (type: 'lock' | 'unlock') => {
    if (type === 'unlock') {
      releaseCurrent();
      return;
    }

    const nextMode = resolveMode();

    // 模式未变，跳过解锁+重新上锁
    if (currentMode === nextMode) {
      return;
    }

    releaseCurrent();
    applyLock(nextMode);
  };

  const dispose = () => {
    releaseCurrent();
    offCompileError();
    offRuntimeError();
  };

  return { setLock, dispose };
}

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

  const loadingRef: { current: ReturnType<typeof createDesignerLoading> | null } = {
    current: null,
  };

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

      async verify() {
        const aiComParams = context.getAiComParams(comId);
        const files: any[] = aiComParams?.data?.files ?? [];
        return eslintVerify(files);
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

      async exportResourceCode(): Promise<string> {
        const project = projectRef.current;
        if (!project) return '';
        return project.exportResourceCode();
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
      async beforeRequest({ meta }) {
        (window as any).__vibeCodingCallbacks__?.onStart?.();
        
        loadingRef.current?.setLock('lock');

        context.getAiComEvents(comId).emit('vibing', true);
      },
      async beforeTurn() {
        const focusArea = (window as any)?._ai_focus_params_?.focusArea;
        const onProgress = (window as any)?._ai_focus_params_?.onProgress;
        loadingRef.current = createDesignerLoading(comId, focusArea, { onProgress });

        projectRef.current = buildProject(comId);
        const data = context.getAiComParams(comId)?.data;
        if (data && typeof data === 'object') {
          requestSourceSnapshotMap.set(data, createSourceSnapshot(data.files ?? []));
        }
      },
      async afterTurn(turn: { id?: string }) {
        const data = context.getAiComParams(comId)?.data;
        if (history && data && typeof data === 'object') {
          await persistAiVersionAfterTurn(comId, history, data, turn);
        }

        (window as any).__vibeCodingCallbacks__?.onComplete?.();

        loadingRef.current?.dispose();
        loadingRef.current = null;

        context.getAiComEvents(comId).emit('vibing', false);
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

    const aiCom = context.getAiComParams(comId);

    // 1. 找出当前 data.files 中存在但目标版本中不存在的文件（需要删除）
    const targetFileNames = new Set(files.map(f => f.path));
    const currentFiles = aiCom?.data?.files ?? [];
    const filesToDelete = currentFiles
      .filter(f => !targetFileNames.has(f.fileName))
      .map(f => f.fileName);

    // 删除多余文件
    for (const fileName of filesToDelete) {
      context.updateFile(comId, { fileName, type: "delete" });
    }

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
