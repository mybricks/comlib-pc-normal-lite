import type { ReplaceResultItem } from "../../../utils/editReplace";

/** 工具 execute/stream 所需的文件（与 type.d.ts 一致） */
type ComponentFileItem = { fileName: string; content: string; isComplete?: boolean };
type NormalizedFileItem = { fileName: string; content: string; isComplete: boolean };
interface RxFile {
  fileName: string;
  name: string;
  extension: string;
  language: string;
  content: string;
  isComplete: boolean;
}

type RxFiles = Record<string, RxFile | RxFile[]>;


/** 将 files 统一为 Array<{ fileName, content, isComplete }>，兼容 array 与 RxFiles */
function normalizeFiles(files: Array<ComponentFileItem | NormalizedFileItem> | RxFiles | undefined): NormalizedFileItem[] {
  if (!files) return [];
  if (Array.isArray(files)) {
    return files
      .map((f) => {
        const raw = f as Record<string, unknown>;
        return {
          fileName: (raw.fileName as string) ?? '',
          content: (raw.content as string) ?? '',
          isComplete: (raw.isComplete as boolean) ?? false,
        };
      })
      .filter((f) => f.fileName);
  }
  const list: NormalizedFileItem[] = [];
  Object.entries(files).forEach(([key, fileOrArr]) => {
    const arr = Array.isArray(fileOrArr) ? fileOrArr : [fileOrArr];
    arr.forEach((f) => {
      const file = f as unknown as Record<string, unknown>;
      const fileName = (file.fileName as string) ?? key;
      if (fileName) {
        list.push({
          fileName,
          content: (file.content as string) ?? '',
          isComplete: (file.isComplete as boolean) ?? false,
        });
      }
    });
  });
  return list;
}

/** 用 normalizeFiles 结果按 (comId, baseFileName) 分组后调用 onComponentUpdate */
function applyFilesToOnComponentUpdate(
  files: NormalizedFileItem[],
  config: {
    focusComId?: string;
    onComponentUpdate: (comId: string, fileName: string, content: string) => void;
    updatedKeys?: Set<string>;
  }
) {
  const { focusComId, onComponentUpdate, updatedKeys } = config;
  const seen = updatedKeys ?? new Set<string>();
  type Group = { comId: string; baseFileName: string; items: NormalizedFileItem[] };
  const groupBy = new Map<string, Group>();

  files.forEach((item) => {
    const { fileName } = item;
    const comId = focusComId ?? '';
    const baseFileName = fileName;
    if (!comId) return;
    const key = `${comId}|${baseFileName}`;
    if (!groupBy.has(key)) groupBy.set(key, { comId, baseFileName, items: [] });
    groupBy.get(key)!.items.push(item);
  });

  groupBy.forEach((group, key) => {
    if (seen.has(key)) return;
    const { comId, baseFileName, items } = group;
    let content: string;
    if (items.length >= 2 && items[0].isComplete && items[1].isComplete) {
      const has0 = items[0].content.length > 0;
      const has1 = items[1].content.length > 0;
      if (has1) content = items[1].content;
      else if (has0) content = items[0].content;
      else return;
    } else if (items.length === 1 && items[0].isComplete && items[0].content.length > 0) {
      content = items[0].content;
    } else return;
    seen.add(key);
    console.log('[开发模块 - 文件更新]', { comId, fileName: baseFileName, contentLength: content.length, contentPreview: content.slice(0, 80) + (content.length > 80 ? '...' : '') });
    onComponentUpdate(comId, baseFileName, content);
  });
}

/** 单个文件的更新结果（与 updateComponentFiles 返回结构一致） */
export type FileUpdateResult = {
  fileName: string;
  dataKey: string;
  fullReplace: boolean;
  replaceCount: number;
  results: ReplaceResultItem[];
  success: boolean;
};

/** updateComponentFiles 的返回值 */
type UpdateComponentFilesResult = {
  comId: string;
  fileResults: FileUpdateResult[];
  success: boolean;
};

/** 将更新结果格式化为给用户/模型展示的文案 */
function formatUpdateResult(result: UpdateComponentFilesResult): string {
  if (result.success) {
    const lines: string[] = [];
    for (const r of result.fileResults) {
      const total = r.results.length;
      r.results.forEach((_, idx) => {
        lines.push(`${r.fileName} 第 ${idx + 1}/${total} 步：成功`);
      });
    }
    return `\n准备执行修改\n\n${lines.join('\n')}`;
  }
  const failed = result.fileResults.filter((r) => !r.success);
  const lines: string[] = [];
  for (const r of failed) {
    const total = r.results.length;
    r.results.forEach((item, idx) => {
      const msg = item.ok ? '成功' : (item.message ?? item.error ?? '未知错误');
      lines.push(`${r.fileName} 第 ${idx + 1}/${total} 步：${msg}`);
    });
  }
  return `\n准备执行修改\n\n${lines.join('\n')}\n\n所有操作已回退，请重新生成`;
}

export { normalizeFiles, formatUpdateResult };
export type { UpdateComponentFilesResult };