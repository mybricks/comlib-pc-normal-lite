/**
 * mix sandbox adapter
 *
 * 实现 plugin-ai 的 Designer + Hooks 接口，通过 window._sandbox_.connectToAI 注册。
 *
 * 核心设计：
 * - project 实例在 sandbox 注册时兜底创建，并在 hooks.beforeTurn 中刷新。
 * - Designer 方法通过 projectRef.current 访问当前 project 实例，运行模式和画布状态实时读取。
 */

import context, { Version } from '../context';
import { debugLogs } from '../context/debugLogs';
import { createProject } from './codeBase';
import { updateComponentFiles } from '../agent/vibeCoding/tools/utils/files';
import { uuid } from '../../utils';
import { verify as eslintVerify, RULE_IDS } from '../eslint';
import { randomUUID } from '../utils/uuid'
import { checkVisibility } from '../../utils/ai-code/render/mybricks/checkVisibility-polyfill';
import { undoRedoManager } from '../editors/undoRedo';
import { parseLess, stringifyLess } from '../utils/transform/less';

const VERIFY_CONFIG = {
  rules: {
    // [RULE_IDS.README_CHECK]: 'off' as const,
    [RULE_IDS.REQUIREMENT_CHECK]: 'error' as const,
  },
};

// ─── 内部状态 ─────────────────────────────────────────────────────────────────

/**
 * 每个 comId 对应一个 projectRef，在 sandbox 注册时兜底初始化，并在 beforeTurn 时刷新。
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

// ─── 文件 diff 工具 ────────────────────────────────────────────────────────────

/**
 * 将一组目标文件 diff 应用到 comId 对应的组件，仅写入有变化的文件。
 * - 目标中不存在的文件会被删除
 * - 目标中新增或内容有变更的文件才会触发更新
 */
function applyFileDiff(
  comId: string,
  targetFiles: Array<{ path: string; content: string }>,
) {
  const updateFileNames: string[] = []
  const currentData = context.component?.params?.data;
  const currentMap = new Map<string, string>(
    (currentData?.files ?? []).map((f: any) => [
      f.fileName,
      typeof f.source === 'string' ? decodeURIComponent(f.source) : '',
    ])
  );
  const targetMap = new Map(targetFiles.map((f) => [f.path, f.content]));

  // 删除目标中不存在的文件
  for (const fileName of currentMap.keys()) {
    if (!targetMap.has(fileName)) {
      updateFileNames.push(fileName)
      context.updateFile({ fileName, type: 'delete' });
    }
  }
  // 新增或变更的文件
  for (const [fileName, content] of targetMap) {
    if (currentMap.get(fileName) !== content) {
      updateFileNames.push(fileName)
      context.updateFile({ fileName, content });
    }
  }

  return updateFileNames
}

// ─── 构建 project 快照 ────────────────────────────────────────────────────────

function buildProject(comId: string) {
  const aiComParams = context.component?.params;

  let runtimeError: any = null
  const events = context.component!.events
  events.on('runtimeError', (error) => {
    runtimeError = error
  })

  let fileSystem

  return createProject({
    getFiles: () => aiComParams?.data?.files ?? [],
    getDesignerState: () => {
      const canvasList = context.getCanvasList() as HTMLDivElement[]
      const pages: Array<{ name: string; visible: boolean }> = []
      const popups: Array<{ name: string; visible: boolean }> = []
      canvasList.forEach((div: HTMLDivElement) => {
        const widgetName = div.getAttribute('data-widget-name')
        const zoneKind = div.getAttribute('data-zone-kind')
        if (zoneKind === 'page') {
          pages.push({ name: widgetName || "页面", visible: true })
        } else if (zoneKind === 'popup') {
          // 检查弹窗的所有子元素是否可见：若全部不可见，则认为弹窗未展示
          const children = Array.from(div.children) as Element[]
          const visible = children.length > 0 && children.some((child) => {
            return checkVisibility(child)
          })
          popups.push({ name: widgetName || '弹窗', visible })
        }
      })

      return {
        pages,
        popups
      }
    },
    getFileSystem: () => {
      // 获取文件状态，vibing状态下，有部分文件可能还没编写完成
      return context.fileSystem!
    },
    getErrors: () => {
      if (!fileSystem) {
        fileSystem = context.fileSystem
      }

      const errors: any[] = [];

      if (fileSystem) {
        errors.push(...fileSystem.getErrors())
      }

      if (runtimeError && !errors.find((error) => error === runtimeError)) {
        // 有运行时错误，写入errors列表
        errors.push(runtimeError)
      }

      return errors.concat(aiComParams?.data?._errors || [])
    },
    getLogs: () => debugLogs.get(comId),
    getRuntimeMode: () => context.component?.params?.data?.runtimeMode,
    getLintResults: async () => {
      const messages: any[] = [];
      const files: any[] = aiComParams?.data?.files ?? [];
      const componentRuntime = window._sandbox_?.config?.componentRuntime

      if (componentRuntime) {
        const { eslint, modules } = componentRuntime
        if (eslint) {
          const { rules, verify } = eslint
          if (rules) {
            Object.assign(VERIFY_CONFIG.rules, eslint.rules)
          }
          if (verify) {
            messages.push(...await verify(files))
          }
        }
        if (modules) {
          await Promise.all(Object.entries(modules).map(async ([key, value]: any) => {
            const eslintVerify = value.eslint.verify
            if (eslintVerify) {
              messages.push(...await eslintVerify(files))
            }
          }))
        }
      }

      messages.push(...await eslintVerify(files, VERIFY_CONFIG))

      return messages;
    },
  });
}

function refreshProjectBaseline(
  comId: string,
  projectRef: { current: ReturnType<typeof createProject> | undefined }
) {
  projectRef.current = buildProject(comId);
  const data = context.component?.params?.data;
  if (data && typeof data === 'object') {
    requestSourceSnapshotMap.set(data, createSourceSnapshot(data.files ?? []));
  }
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
  type: 'ai' | 'manual' | 'rollback' | 'init';
  createdAt: number;
  summary?: string;
}

type SandboxHistory = {
  listVersions: (params: { pageSize: number, pageNum: number }) => Promise<{ list: VersionRecord[], total: number }>;
  addVersion: (record: VersionRecord, files: VersionFile[]) => Promise<void>;
  updateVersion: (versionId: string, patch: Partial<VersionRecord>) => Promise<void>;
  getVersion: (versionId: string) => Promise<VersionRecord | undefined>;
  getVersionFiles: (versionId: string) => Promise<VersionFile[]>;
};

type VersionDiffChangeType = 'added' | 'deleted' | 'modified';

interface VersionDiffCodeBlock {
  type: VersionDiffChangeType;
  beforeStartLine: number;
  beforeEndLine: number;
  afterStartLine: number;
  afterEndLine: number;
  before: string;
  after: string;
}

interface VersionFileDiff {
  path: string;
  type: VersionDiffChangeType;
  before: string;
  after: string;
  blocks: VersionDiffCodeBlock[];
}

interface VersionPairDiff {
  oldVersionId: string;
  newVersionId: string;
  files: VersionFileDiff[];
}

interface VersionDiffResult {
  versionIds: string[];
  diffs: VersionPairDiff[];
}

function normalizeVersionFiles(files: VersionFile[] = []): VersionFile[] {
  return files.map((file: any) => ({
    path: typeof file?.path === 'string' ? file.path : file?.fileName ?? '',
    content: typeof file?.content === 'string' ? file.content : file?.source ?? '',
  })).filter((file) => file.path);
}

function createVersionFileMap(files: VersionFile[]): Map<string, string> {
  return new Map(normalizeVersionFiles(files).map((file) => [file.path, file.content]));
}

function splitCodeLines(content: string): string[] {
  if (!content) return [];
  return content.split('\n');
}

function isCssLikePath(path: string): boolean {
  return /\.(css|less|scss|sass|styl)$/i.test(path);
}

function lineNumberAtOffset(content: string, offset: number): number {
  if (offset <= 0) return 1;
  let line = 1;
  const end = Math.min(offset, content.length);
  for (let i = 0; i < end; i++) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

type CssRuleUnit = {
  key: string;
  selector: string;
  full: string;
  body: string;
  startLine: number;
  endLine: number;
};

function normalizeCssSelector(selector: string): string {
  return selector.replace(/\s+/g, ' ').trim();
}

function normalizeCssBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

/**
 * 拆分顶层 CSS 规则（含 @media / @keyframes 整块）。
 * 行级 LCS 在格式化/重排后会把无关规则错配成 modified，样式文件改走选择器匹配。
 */
function parseTopLevelCssRules(content: string): CssRuleUnit[] {
  if (!content) return [];

  const rules: CssRuleUnit[] = [];
  let i = 0;
  const len = content.length;

  const skipWhitespaceAndComments = () => {
    while (i < len) {
      if (/\s/.test(content[i])) {
        i += 1;
        continue;
      }
      if (content[i] === '/' && content[i + 1] === '*') {
        i += 2;
        while (i < len - 1 && !(content[i] === '*' && content[i + 1] === '/')) {
          i += 1;
        }
        i += 2;
        continue;
      }
      if (content[i] === '/' && content[i + 1] === '/') {
        i += 2;
        while (i < len && content[i] !== '\n') i += 1;
        continue;
      }
      break;
    }
  };

  while (i < len) {
    skipWhitespaceAndComments();
    if (i >= len) break;

    const selectorStart = i;
    while (i < len && content[i] !== '{') {
      const ch = content[i];
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i += 1;
        while (i < len && content[i] !== quote) {
          if (content[i] === '\\') i += 1;
          i += 1;
        }
        i += 1;
        continue;
      }
      i += 1;
    }
    if (i >= len) break;

    const selector = content.slice(selectorStart, i).trim();
    const openIdx = i;
    i += 1;
    let depth = 1;
    while (i < len && depth > 0) {
      const ch = content[i];
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i += 1;
        while (i < len && content[i] !== quote) {
          if (content[i] === '\\') i += 1;
          i += 1;
        }
        i += 1;
        continue;
      }
      if (ch === '/' && content[i + 1] === '*') {
        i += 2;
        while (i < len - 1 && !(content[i] === '*' && content[i + 1] === '/')) {
          i += 1;
        }
        i += 2;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }

    const closeIdx = i - 1;
    if (!selector || depth !== 0) continue;

    const body = content.slice(openIdx + 1, closeIdx);
    const full = content.slice(selectorStart, closeIdx + 1);
    rules.push({
      key: normalizeCssSelector(selector),
      selector,
      full: full.trim(),
      body,
      startLine: lineNumberAtOffset(content, selectorStart),
      endLine: lineNumberAtOffset(content, closeIdx),
    });
  }

  return rules;
}

/** 按选择器对齐的 CSS diff，避免行级 LCS 错配无关规则 */
function buildCssRuleDiffBlocks(before: string, after: string): VersionDiffCodeBlock[] {
  const beforeRules = parseTopLevelCssRules(before);
  const afterRules = parseTopLevelCssRules(after);

  const afterByKey = new Map<string, CssRuleUnit[]>();
  for (const rule of afterRules) {
    const list = afterByKey.get(rule.key) ?? [];
    list.push(rule);
    afterByKey.set(rule.key, list);
  }

  const usedAfter = new Set<CssRuleUnit>();
  const blocks: VersionDiffCodeBlock[] = [];

  for (const oldRule of beforeRules) {
    const candidates = afterByKey.get(oldRule.key) ?? [];
    const match = candidates.find((item) => !usedAfter.has(item));
    if (!match) {
      blocks.push({
        type: 'deleted',
        beforeStartLine: oldRule.startLine,
        beforeEndLine: oldRule.endLine,
        afterStartLine: 0,
        afterEndLine: 0,
        before: oldRule.full,
        after: '',
      });
      continue;
    }

    usedAfter.add(match);
    if (normalizeCssBody(oldRule.body) === normalizeCssBody(match.body)) {
      continue;
    }

    blocks.push({
      type: 'modified',
      beforeStartLine: oldRule.startLine,
      beforeEndLine: oldRule.endLine,
      afterStartLine: match.startLine,
      afterEndLine: match.endLine,
      before: oldRule.full,
      after: match.full,
    });
  }

  for (const newRule of afterRules) {
    if (usedAfter.has(newRule)) continue;
    blocks.push({
      type: 'added',
      beforeStartLine: 0,
      beforeEndLine: 0,
      afterStartLine: newRule.startLine,
      afterEndLine: newRule.endLine,
      before: '',
      after: newRule.full,
    });
  }

  return blocks;
}

function createWholeFileBlock(type: VersionDiffChangeType, before: string, after: string): VersionDiffCodeBlock[] {
  const beforeLines = splitCodeLines(before);
  const afterLines = splitCodeLines(after);
  return [{
    type,
    beforeStartLine: beforeLines.length ? 1 : 0,
    beforeEndLine: beforeLines.length,
    afterStartLine: afterLines.length ? 1 : 0,
    afterEndLine: afterLines.length,
    before,
    after,
  }];
}

function buildLineDiffBlocks(before: string, after: string): VersionDiffCodeBlock[] {
  const beforeLines = splitCodeLines(before);
  const afterLines = splitCodeLines(after);

  const beforeLength = beforeLines.length;
  const afterLength = afterLines.length;
  const lcs: number[][] = Array.from({ length: beforeLength + 1 }, () => Array(afterLength + 1).fill(0));

  for (let i = beforeLength - 1; i >= 0; i--) {
    for (let j = afterLength - 1; j >= 0; j--) {
      lcs[i][j] = beforeLines[i] === afterLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const blocks: VersionDiffCodeBlock[] = [];
  let i = 0;
  let j = 0;
  let pendingBeforeStart = -1;
  let pendingAfterStart = -1;
  let pendingBeforeLines: string[] = [];
  let pendingAfterLines: string[] = [];

  const appendDelete = () => {
    if (pendingBeforeStart < 0) pendingBeforeStart = i;
    if (pendingAfterStart < 0) pendingAfterStart = j;
    pendingBeforeLines.push(beforeLines[i]);
    i++;
  };

  const appendAdd = () => {
    if (pendingBeforeStart < 0) pendingBeforeStart = i;
    if (pendingAfterStart < 0) pendingAfterStart = j;
    pendingAfterLines.push(afterLines[j]);
    j++;
  };

  const flush = () => {
    if (pendingBeforeStart < 0 && pendingAfterStart < 0) return;

    const beforeCount = pendingBeforeLines.length;
    const afterCount = pendingAfterLines.length;
    const type: VersionDiffChangeType = beforeCount === 0 ? 'added' : afterCount === 0 ? 'deleted' : 'modified';
    blocks.push({
      type,
      beforeStartLine: beforeCount ? pendingBeforeStart + 1 : pendingBeforeStart,
      beforeEndLine: beforeCount ? pendingBeforeStart + beforeCount : pendingBeforeStart,
      afterStartLine: afterCount ? pendingAfterStart + 1 : pendingAfterStart,
      afterEndLine: afterCount ? pendingAfterStart + afterCount : pendingAfterStart,
      before: pendingBeforeLines.join('\n'),
      after: pendingAfterLines.join('\n'),
    });

    pendingBeforeStart = -1;
    pendingAfterStart = -1;
    pendingBeforeLines = [];
    pendingAfterLines = [];
  };

  while (i < beforeLength || j < afterLength) {
    if (i < beforeLength && j < afterLength && beforeLines[i] === afterLines[j]) {
      flush();
      i++;
      j++;
    } else if (j < afterLength && (i >= beforeLength || lcs[i][j + 1] >= lcs[i + 1][j])) {
      appendAdd();
    } else if (i < beforeLength) {
      appendDelete();
    }
  }
  flush();

  return blocks;
}

function diffVersionFiles(oldVersionId: string, newVersionId: string, oldFiles: VersionFile[], newFiles: VersionFile[]): VersionPairDiff {
  const oldFileMap = createVersionFileMap(oldFiles);
  const newFileMap = createVersionFileMap(newFiles);
  const paths = Array.from(new Set([...oldFileMap.keys(), ...newFileMap.keys()])).sort();
  const files: VersionFileDiff[] = [];

  for (const path of paths) {
    const hasOldFile = oldFileMap.has(path);
    const hasNewFile = newFileMap.has(path);
    const before = oldFileMap.get(path) ?? '';
    const after = newFileMap.get(path) ?? '';

    if (hasOldFile && hasNewFile && before === after) {
      continue;
    }

    const type: VersionDiffChangeType = !hasOldFile ? 'added' : !hasNewFile ? 'deleted' : 'modified';
    files.push({
      path,
      type,
      before,
      after,
      blocks:
        type === 'modified'
          ? isCssLikePath(path)
            ? buildCssRuleDiffBlocks(before, after)
            : buildLineDiffBlocks(before, after)
          : createWholeFileBlock(type, before, after),
    });
  }

  return {
    oldVersionId,
    newVersionId,
    files,
  };
}

async function diffVersions(history: SandboxHistory, ...versionIds: string[]): Promise<VersionDiffResult> {
  if (versionIds.length < 2) {
    throw new Error('diff 至少需要传入 2 个版本 ID');
  }

  const versionFiles = await Promise.all(versionIds.map((versionId) => history.getVersionFiles(versionId)));
  return {
    versionIds,
    diffs: versionIds.slice(0, -1).map((oldVersionId, index) => {
      const newVersionId = versionIds[index + 1];
      return diffVersionFiles(oldVersionId, newVersionId, versionFiles[index], versionFiles[index + 1]);
    }),
  };
}

// turn.id 到 version.id 的映射
const TURNID_TO_RECORD = {}

// 记录 turn.id 对应的操作记录
class TurnLogs {
  logs: Record<string, any[]> = {}

  turnID?: string

  constructor() {
    window['_mybricks_ai_com_turn_logs_'] = () => {
      return this.logs
    }
  }

  setLog(log) {
    const turnID = this.turnID
    if (!turnID) {
      return
    }
    if (!this.logs[turnID]) {
      this.logs[turnID] = [log]
    } else {
      this.logs[turnID].push(log)
    }
  }
}

const turnLogs = new TurnLogs()

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
  if (!hasSourceChanged(data.files ?? [], previousSnapshot)) {
    turnLogs.setLog({ message: '[版本/跳过] 源码无变更 — 不记录版本' })
    return
  };

  const files: VersionFile[] = (data.files ?? [])
    .filter((f: any) => f.source)
    .map((f: any) => ({
      path: f.fileName,
      content: decodeURIComponent(f.source),
    }));

  const version = context.version
  const total = version.total
  // 版本号 +1
  version.total = total + 1

  const record: VersionRecord = {
    id: randomUUID(),
    turnId: turn?.id ?? '',
    label: `V${total}`,
    type: 'ai',
    createdAt: Date.now(),
  };

  turnLogs.setLog({
    message: '[版本/检测] 源码有变更 — 准备写入版本记录',
    record
  })

  version.addPromiseTask(async () => {
    turnLogs.setLog({
      message: '[版本/写入] 开始写入版本至历史存储',
      record
    })
    await history.addVersion(record, files);
    turnLogs.setLog({
      message: '[版本/写入] 版本已成功持久化至历史存储',
      record
    })
  })

  TURNID_TO_RECORD[record.turnId] = record;
  context.notifyVersionsChange(record);

  // ── undo/redo 支持 ────────────────────────────────────────────────────────
  // previousSnapshot: Map<fileName, encodedSource>（beforeTurn 快照，未解码）
  // files: VersionFile[]（AI 产出的新内容，已解码）

  // 将 previousSnapshot (Map<fileName, encodedSource>) 转换为 VersionFile[]
  const prevFiles: Array<{ path: string; content: string }> = [];
  if (previousSnapshot) {
    for (const [fileName, encodedSource] of previousSnapshot) {
      prevFiles.push({ path: fileName, content: decodeURIComponent(encodedSource) });
    }
  }

  // files 已在外部声明（AI 产出），复制一份闭包内引用
  const nextFiles = files;

  undoRedoManager.record({
    execute() {
      // 重做：将文件恢复为 AI 修改后的状态
      const updateFileNames = applyFileDiff(comId, nextFiles);
      context.saveManualVersion(updateFileNames);
    },
    undo() {
      // 撤回：将文件恢复为 AI 修改前的状态
      const updateFileNames = applyFileDiff(comId, prevFiles);
      context.saveManualVersion(updateFileNames);
    },
  });
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
  let extra: Record<string, any> = {}

  const events = context.component!.events
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

  const { actions } = context.component!;

  // 当前生效的锁模式：progress = onProgress 整页；component = actions.lock 组件锁；null = 未上锁
  let currentMode: 'progress' | 'component' | null = null;
  let releaseLock: (() => void) | null = () => {
    turnLogs.setLog({
      message: '[锁/释放] 空操作释放 — 锁从未被申请',
    });
  };

  const resolveMode = (): 'progress' | 'component' =>
    !focusArea || compileError || runtimeError || hasErrorOccurred || (extra.source === '@updateSegment:changeOrder') ? 'progress' : 'component';

  const applyLock = (mode: 'progress' | 'component') => {
    if (mode === 'progress') {
      options?.onProgress?.('start');
      releaseLock = () => {
        options?.onProgress?.('complete');
        turnLogs.setLog({
          message: '[锁/释放] 进度模式锁已释放 — 已调用 onProgress(complete)',
          onProgress: typeof options?.onProgress
        });
      };
    } else {
      const lockResult = actions.lock(lockId, focusArea);
      releaseLock = () => {
        turnLogs.setLog({
          message: '[锁/释放] 组件模式锁释放中 — 检查 lockResult 类型',
          lockResult: typeof lockResult
        });
        if (typeof lockResult === 'function') {
          turnLogs.setLog({
            message: '[锁/释放] 组件模式锁已释放 — 通过 lockResult 回调解锁',
          });
          lockResult()
        } else {
          turnLogs.setLog({
            message: '[锁/释放] 组件模式锁已释放 — 通过 actions.unlock() 解锁',
          });
          actions.unlock(lockId, focusArea);
        }
      }
    }
    currentMode = mode;
  };

  const releaseCurrent = () => {
    turnLogs.setLog({
      message: '[锁/releaseCurrent] 调用当前锁的释放处理器',
      releaseLock: typeof releaseLock
    });
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
    turnLogs.setLog({
      message: '[加载/销毁] 设计器 loading 实例已销毁 — 释放锁并移除错误监听器',
    });
    releaseCurrent();
    offCompileError();
    offRuntimeError();
  };

  const setExtra = (_extra) => {
    if (_extra) {
      extra = _extra
    }
  }

  return {
    setLock,
    dispose,
    setExtra};
}

// ─── 注册沙箱 ─────────────────────────────────────────────────────────────────

const REGISTER_COMIDS = new Set<string>()
/**
 * 注册组件沙箱到 plugin-ai。
 * 在 editors/index.tsx 中 context.setAiCom 之后调用。
 */
export async function registerSandbox(comId: string): Promise<void> {
  if (REGISTER_COMIDS.has(comId)) {
    return
  }
  REGISTER_COMIDS.add(comId)
  const connectToAI = (window as any)._sandbox_?.connectToAI;
  if (typeof connectToAI !== 'function') {
    // console.warn('[mix/sandbox] window._sandbox_.connectToAI not found, skipping sandbox registration');
    return;
  }

  const loadingRef: { current: ReturnType<typeof createDesignerLoading> | null } = {
    current: null,
  };

  const projectRef = getProjectRef(comId);
  refreshProjectBaseline(comId, projectRef);

  const designerFs = {
      // ── 文件系统 ──────────────────────────────────────────────────────────

      async getFiles() {
        const aiComParams = context.component?.params;
        const files: any[] = aiComParams?.data?.files ?? [];
        return files
          .filter((f) => f.source)
          .map((f) => ({
            path: f.fileName,
            content: decodeURIComponent(f.source),
          }));
      },

      async verify() {
        const aiComParams = context.component?.params;
        const files: any[] = aiComParams?.data?.files ?? [];
        return await eslintVerify(files, VERIFY_CONFIG);
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

      getEffectiveLibraries() {
        const project = projectRef.current;
        if (!project) return [];
        return project.getEffectiveLibraries();
      },

      // ── 设计器状态 ────────────────────────────────────────────────────────

      async exportDesignerToMessage(): Promise<string> {
        const project = projectRef.current;
        if (!project) return '';
        return project.exportDesignerToMessage();
      },

      getLogList(query?: { page?: number; pageSize?: number; like?: Record<string, string> }) {
        const project = projectRef.current;
        if (!project) return { total: 0, page: query?.page ?? 1, pageSize: query?.pageSize ?? 20, items: [] };
        return project.getLogList(query);
      },

      getLogDetail(id: string) {
        const project = projectRef.current;
        if (!project) return undefined;
        return project.getLogDetail(id);
      },

      getRuntimeMode(): string | undefined {
        return context.component?.params?.data?.runtimeMode;
      },

      // /**
      //  * 与 vibeCoding 请求相同的 loading控制器；focusArea 无选区时走 params.onProgress。
      //  */
      // loading(focusArea: any, opts?: DesignerLoadingOptions) {
      //   return createDesignerLoading(comId, focusArea, opts);
      // },
  };

  // connectToAI 注册 Designer；同时把写文件能力挂到 _sandbox_.helpers 供 SPA 调用
  const { history } = connectToAI(comId, {
    designer: designerFs,
    hooks: {
      async beforeRequest({ meta, extra }) {
        (window as any).__vibeCodingCallbacks__?.onStart?.();
        
        loadingRef.current?.setExtra(extra);
        loadingRef.current?.setLock('lock');

        context.component?.events.emit('vibing', true);
      },
      async beforeTurn() {
        const focusArea = (window as any)?._ai_focus_params_?.focusArea;
        const onProgress = (window as any)?._ai_focus_params_?.onProgress;
        loadingRef.current = createDesignerLoading(comId, focusArea, { onProgress });
        refreshProjectBaseline(comId, projectRef);
      },
      async afterTurn(turn: { id?: string }) {
        (window as any)._sendToAgent_source_ = null
        turnLogs.turnID = turn.id
        turnLogs.setLog({
          message: '[轮次/afterTurn] 本轮结束 — 开始执行轮后处理',
        })
        const data = context.component?.params?.data;

        Array.from(context.chipPromiseIds).forEach((id) => {
          context.chipPromiseIds.delete(id)
          context.component!.actions!.promiseCancel(id)
        })

        if (history && data && typeof data === 'object') {
          await persistAiVersionAfterTurn(comId, history, data, turn);
        }

        turnLogs.setLog({
          message: '[轮次/afterTurn] 版本已持久化 — 通知 UI 并销毁设计器 loading',
          dispose: typeof loadingRef.current?.dispose
        });

        (window as any).__vibeCodingCallbacks__?.onComplete?.(turn);

        loadingRef.current?.dispose();
        loadingRef.current = null;

        context.component?.events.emit('vibing', false);
      },
      async afterTurnSummary(turn: { id?: string }, summary: string) {
        turnLogs.setLog({
          message: '[轮次/afterTurnSummary] 收到 summary 回调 — 开始更新版本摘要',
          summary
        });
        if (!history || !turn?.id) {
          turnLogs.setLog({
            message: '[轮次/afterTurnSummary] 已中止 — history 存储或 turn.id 不可用',
          });
          return
        };

        const target = TURNID_TO_RECORD[turn.id]

        if (!target) {
          turnLogs.setLog({
            message: '[轮次/afterTurnSummary] 已中止 — 未找到 turn.id 对应的版本记录',
          });
          return
        };

        turnLogs.setLog({
          message: '[轮次/afterTurnSummary] 正在更新历史存储中的版本摘要',
        });

        await history.updateVersion(target.id, { summary });

        turnLogs.setLog({
          message: '[轮次/afterTurnSummary] 版本摘要更新成功 — 通知 UI',
        });

        target.summary = summary

        // 通知 UI
        context.notifyVersionsChange(target);
      },
    },
    chips: {
      ['element-move']: {
        onRemove(params) {
          console.log('element-move', params)
          context.chipPromiseIds.delete(params.id)
          context.component!.actions!.promiseCancel(params.id)
        }
      },
      ['element-text-update']: {
        onRemove(params) {
          console.log('element-text-update', params)
          context.chipPromiseIds.delete(params.id)
          context.component!.actions!.promiseCancel(params.id)
        }
      },
      ['element-delete']: {
        onRemove(params) {
          console.log('element-delete', params)
          context.chipPromiseIds.delete(params.id)
          context.component!.actions!.promiseCancel(params.id)
        }
      }
    }
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

    // diff 比对，按需更新文件（新增 / 变更 / 删除）
    applyFileDiff(comId, files);

    // 3. 新增一条 rollback 类型版本记录
    const version = context.version
    const total = version.total
    // 版本号 +1
    version.total = total + 1

    const rollbackRecord: VersionRecord = {
      id: randomUUID(),
      turnId: targetMeta.turnId,
      label: `V${total}`,
      type: 'rollback',
      createdAt: Date.now(),
      summary: `回滚自 ${targetMeta.label}`,
    };

    version.addPromiseTask(async () => {
      await history.addVersion(rollbackRecord, files);
      // 5. 触发保存（保持与原逻辑一致）
      (window as any)._mybricksOnEdit_?.({ autoSave: true });
    })

    // 4. 通知 UI
    context.notifyVersionsChange(rollbackRecord);
  }

  const data = context.component?.params?.data;
  const files = (data?.files ?? [])
    .filter((f: any) => f.source)
    .map((f: any) => ({
      path: f.fileName,
      content: decodeURIComponent(f.source),
    }));

  // 初始化版本（必须在暴露 updateFiles 之前完成）。
  // 否则 mhtml 还原会在 listVersions await 期间先 notifyExternalVersion 推高 total，
  // 随后这里 new Version(0) 把计数冲掉，手动保存又会再写一个 V0。
  const { list } = await history.listVersions({ pageSize: 1, pageNum: 1 })
  if (!list.length) {
    // 没有版本
    if (files.length) {
      // 有内容，写一条默认版本
      const record = {
        id: randomUUID(),
        turnId: '',
        label: `V${0}`,
        type: 'init' as const,
        createdAt: Date.now(),
      };
      await history.addVersion(record, files);
      context.version = new Version(1)
    } else {
      context.version = new Version(0)
    }
  } else {
    // 有版本，解析版本total
    context.version = new Version(parseInt(list[0].label.slice(1)) + 1)
  }

  // (context as any).setRollback(comId, rollbackToVersion);
  // (context as any).setHistory(comId, history);

  context.rollback = rollbackToVersion
  context.history = history;
  context.diff = (...versionIds: string[]) => diffVersions(history, ...versionIds);

  // SPA 写文件 / 读 diff 走 _sandbox_.helpers（不改 plugin-ai；由组件库补挂能力）
  // 注意：必须在 context.version 初始化之后再挂 updateFiles，避免还原与版本初始化竞态
  const sandboxHelpers = (window as any)._sandbox_?.helpers;
  if (sandboxHelpers && typeof sandboxHelpers.updateFiles !== 'function') {
    sandboxHelpers.getDesigner = () => designerFs;
    sandboxHelpers.updateFiles = (files: Array<{ path: string; content: string }>) =>
      designerFs.updateFiles(files);
    sandboxHelpers.getFiles = () => designerFs.getFiles();
    sandboxHelpers.deleteFiles = (paths: string[]) => designerFs.deleteFiles(paths);
  }
  // 与 context.diff 同源，供页面工具栏等宿主侧调用
  if (sandboxHelpers && history) {
    sandboxHelpers.diff = (...versionIds: string[]) =>
      diffVersions(history, ...versionIds);
  }
  /**
   * mhtml 还原落 V0 前：less 走与样式编辑器相同的 parseLess → stringifyLess，
   * 避免 Prettier/原始 less 与首次改样式后的整文件重排产生格式化 diff。
   */
  if (sandboxHelpers) {
    sandboxHelpers.normalizeRestoreFiles = (
      files: Array<{ path: string; content: string }>,
    ) => {
      return (files ?? []).map((file) => {
        const ext = file.path.split('.').pop()?.toLowerCase()
        if (ext !== 'less' && ext !== 'css') return file
        if (!file.content?.trim()) return file
        try {
          const normalized = stringifyLess(parseLess(file.content))
          return { ...file, content: normalized }
        } catch (error) {
          console.warn('[normalizeRestoreFiles] less 规范化失败，保留原文', file.path, error)
          return file
        }
      })
    }
  }
  /**
   * SPA 侧（如 mhtml 还原）通过 ServerHistory 写入版本后调用：
   * 1) 推进 context.version.total，避免后续手动/AI 保存仍从 V0 起号
   * 2) 立刻 notifyVersionsChange，让版本面板不必等 list 轮询
   */
  if (sandboxHelpers) {
    sandboxHelpers.notifyExternalVersion = (record: VersionRecord) => {
      if (!context.version) {
        context.version = new Version(0)
      }
      const n = parseInt(String(record?.label ?? '').replace(/^V/i, ''), 10)
      if (!Number.isNaN(n)) {
        context.version.total = Math.max(context.version.total, n + 1)
      } else {
        context.version.total = Math.max(context.version.total, 1)
      }
      // 写入 list，供版本面板首次挂载 / listVersions 尚未返回时做乐观展示
      const prevList = Array.isArray(context.version.list) ? context.version.list : []
      context.version.list = [
        record,
        ...prevList.filter((item) => item.id !== record.id),
      ]
      context.notifyVersionsChange(record)
    }
  }

  context.events.emit('ready', true);
}
