import context, { config, Version } from '../context';
import { findTaskDocumentContent, parseTasksForNotify } from '../tasks/notify';

/** 按运行时配置查找并解码任务文档，未配置目录时回退到 .agent。 */
export function getTaskFileContent() {
  const files = context.component?.params?.data?.files ?? [];
  const configured = (window as any).__LINGCHUANG_CONFIG__?.configDirName
    ?? (window as any)._sandbox_?.config?.configDirName;
  const content = findTaskDocumentContent(files, {
    configDirName: configured,
    fallbackRoot: '.agent',
  });
  return content
}

/** 将同一份任务内容同步到面板和宿主通知；文档缺失时清空已有任务。 */
export function refreshTaskNotification(): void {
  const content = getTaskFileContent()
  context.setTasksContent(content);
  context.notifyUserTaskInfo(content ? parseTasksForNotify(content) : []);
}

// 以下为尚未接入沙箱生命周期的任务检查辅助代码，当前不会阻止轮次结束。
// Agent 类型暂以 any 占位，尚未引入实际类型定义。
// import type { AgentSandbox, ToolCallRecord, TurnRecord } from "../../../../agent/src";
type AgentSandbox = any
type ToolCallRecord = any
type TurnRecord = any

// 仅识别这些文件写入工具；命令执行等其他渠道的修改不会被此集合捕获。
const MUTATION_TOOLS = new Set([
  "write_file", "multi_write", "edit_file", "multi_edit", "delete_file", "init-project",
]);

/** 只有明确的业务源码改动才要求回写任务文档，文档、配置和日志不计入。 */
const BUSINESS_SOURCE_FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "vue", "svelte",
  "css", "less", "scss", "sass",
  "html", "htm",
  "py", "go", "java", "kt", "kts", "rb", "php", "cs", "c", "h", "cpp", "cxx", "hpp", "rs", "swift",
]);

const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/^\.\/+/, "");

const isCurrentTaskPath = (path: string, taskPath: string) => {
  const normalized = normalizePath(path);
  return normalized === taskPath || normalized.endsWith(`/${taskPath}`);
};

const isProjectSourcePath = (path: string, configDirName: string) => {
  // 排除 Agent 配置目录和 Git 元数据，再按扩展名判断业务源码。
  const normalized = normalizePath(path);
  const relative = normalized.replace(/^\/+/, "");
  const configPath = configDirName.replace(/^\/+|\/+$/g, "");
  const isInsideConfig = relative === configPath || relative.startsWith(`${configPath}/`)
    || relative.includes(`/${configPath}/`);
  if (isInsideConfig || relative.split("/").includes(".git")) return false;

  const fileName = relative.split("/").at(-1) ?? "";
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  return !!extension && BUSINESS_SOURCE_FILE_EXTENSIONS.has(extension);
};

/**
 * 优先使用任务 ID；旧文档没有 ID 时仍按标题和同名序号识别。
 */
export function collectPendingVerificationTaskIds(content: string): Set<string> {
  const taskIds = new Set<string>();
  const titleOccurrences = new Map<string, number>();
  const sections = content.split(/(?=^##\s+)/m).filter((section) => /^##\s+/.test(section));

  for (const section of sections) {
    const title = section.split("\n", 1)[0]?.replace(/^##\s+/, "").trim();
    if (!title) continue;

    const occurrence = titleOccurrences.get(title) ?? 0;
    titleOccurrences.set(title, occurrence + 1);
    const id = title.match(/^(T-\d+)\b/)?.[1] ?? `${title}\u0000${occurrence}`;

    const status = section.match(/^\s*-\s*\*{1,2}\s*状态\s*\*{0,2}\s*[：:]\s*([^\n]+)/m)?.[1]
      ?.replace(/[\s*_`]/g, "");
    if (status === "待验证") taskIds.add(id);
  }

  return taskIds;
}

export function hasNewPendingVerificationTask(previousTasks: ReadonlySet<string>, after: string): boolean {
  // 比较待验证集合的差集，已有任务从其他状态进入待验证也属于新增。
  return [...collectPendingVerificationTaskIds(after)].some((taskId) => !previousTasks.has(taskId));
}

/** 只收集成功调用中实际成功写入的路径，批量操作会排除失败子项。 */
function collectMutationPathsForCall(call: ToolCallRecord): string[] {
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) paths.add(normalizePath(value.trim()));
  };

  if (call.status !== "success" || !MUTATION_TOOLS.has(call.name)) return [];
  const metadata = call.result?.metadata;
  switch (call.name) {
    case "write_file":
    case "edit_file":
      add(metadata?.path ?? call.args?.path);
      break;
    case "multi_write":
    case "init-project":
      for (const file of metadata?.files ?? []) {
        if (file?.status !== "error") add(file?.path);
      }
      break;
    case "multi_edit":
      for (const edit of metadata?.edits ?? []) {
        if (!edit?.error) add(edit?.path);
      }
      break;
    case "delete_file":
      for (const path of metadata?.deletedPaths ?? []) add(path);
      break;
  }
  return [...paths];
}

/** 汇总普通迭代的文件修改路径并去重，跳过带 type 的其他迭代记录。 */
function collectMutationPaths(turn: TurnRecord): string[] {
  const paths = new Set<string>();
  for (const iteration of turn.iterations) {
    if ("type" in iteration) continue;
    for (const call of iteration.toolCalls) {
      for (const path of collectMutationPathsForCall(call)) paths.add(path);
    }
  }
  return [...paths];
}

/** 按调用顺序判断：最后一次更新任务文档后，是否成功调用过问答工具。 */
function hasAskQuestionsAfterTaskDocumentUpdate(turn: TurnRecord, taskPath: string): boolean {
  let taskDocumentUpdated = false;
  let askedAfterLatestTaskDocumentUpdate = false;

  for (const iteration of turn.iterations) {
    if ("type" in iteration) continue;
    for (const call of iteration.toolCalls) {
      if (collectMutationPathsForCall(call).some((path) => isCurrentTaskPath(path, taskPath))) {
        // 再次修改文档会使此前问答失效，必须以最新一次文档修改为起点。
        taskDocumentUpdated = true;
        askedAfterLatestTaskDocumentUpdate = false;
        continue;
      }
      if (taskDocumentUpdated && call.name === "ask_questions" && call.status === "success") {
        askedAfterLatestTaskDocumentUpdate = true;
      }
    }
  }

  return askedAfterLatestTaskDocumentUpdate;
}

// 停止前检查的预留参数；当前尚无消费此类型的检查入口。
type TaskFirstStopCheckOptions = {
  sandbox: AgentSandbox;
  configDirName: string;
  taskPath: string;
};
