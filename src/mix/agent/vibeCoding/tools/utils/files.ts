import type { ReplaceResultItem } from "../../../utils/editReplace";
import { multiReplaceFile } from "../../../utils";

/** 工具 execute/stream 所需的文件（与 type.d.ts 一致） */
export type ComponentFileItem = { fileName: string; content: string; isComplete?: boolean; language: string };
export interface RxFile {
  fileName: string;
  name: string;
  extension: string;
  language: string;
  content: string;
  isComplete: boolean;
}

export const SUPPORTED_FILE_EXTENSION = new Set(['jsx', 'less', 'js', 'md', 'ts', 'tsx', 'yaml', 'yml', 'txt', 'json']);
export const SUPPORTED_FILE_LANGUAGE = new Set(['write', 'delete', 'before', 'after']);

/** 单个文件的更新结果（与 updateComponentFiles 返回结构一致） */
export type FileUpdateResult = {
  fileName: string;
  dataKey: string;
  fullReplace: boolean;
  replaceCount: number;
  results: ReplaceResultItem[];
  success: boolean;
};

/** 编译或校验错误（来自 data._errors） */
export type CompileError = {
  file: string;
  message: string;
  /** compile=编译失败（Babel转译报错）; validate=三方库AST校验错误 */
  type: 'compile' | 'validate';
};

/** updateComponentFiles 的返回值 */
type UpdateComponentFilesResult = {
  comId: string;

  /** 文件合并（before/after patch）结果 */
  fileResults: FileUpdateResult[];
  /** 所有文件合并是否全部成功 */
  mergeSuccess: boolean;

  /** 编译/校验错误列表（来自 data._errors） */
  compileErrors: CompileError[];
  /** 没有编译/校验错误 */
  compileSuccess: boolean;

  /** 综合结果：mergeSuccess && compileSuccess，保持原有调用方兼容 */
  success: boolean;

  /** 是否有文件更新 */
  updateFile: boolean;
};

/** 将更新结果格式化为给用户/模型展示的文案 */
function formatUpdateResult(result: UpdateComponentFilesResult): string {
  const lines: string[] = [];

  if (!result.mergeSuccess) {
    const failed = result.fileResults.filter((r) => !r.success);
    for (const r of failed) {
      const total = r.results.length;
      r.results.forEach((item, idx) => {
        const msg = item.ok ? '成功' : (item.message ?? item.error ?? '未知错误');
        lines.push(`${r.fileName} 第 ${idx + 1}/${total} 步：${msg}`);
      });
    }
    return `\n准备执行修改\n\n${lines.join('\n')}\n\n所有操作已回退，请重新生成`;
  }

  // 合并成功，展示合并步骤
  for (const r of result.fileResults) {
    const total = r.results.length;
    r.results.forEach((_, idx) => {
      lines.push(`${r.fileName} 第 ${idx + 1}/${total} 步：成功`);
    });
  }

  return `\n准备执行修改\n\n${lines.join('\n')}`;
}

function updateComponentFiles(
  files: Array<ComponentFileItem>,
  comId: string,
  context: any
): UpdateComponentFilesResult {
  const aiComParams = context.component?.params;
  const fileResults: FileUpdateResult[] = [];
  /** 事务：先计算所有结果，仅当全部成功时才写入；有任一失败则不写任何文件 */
  const pendingWrites: Array<{ fileName: string; content: string }> = [];

  const fileNames = [...new Set(
    files
      .filter((f) => (
        // SUPPORTED_FILE_EXTENSION.has(f.fileName.split('.').pop() ?? '') &&
        SUPPORTED_FILE_LANGUAGE.has(f.language)
      ))
      .map((f) => f.fileName)
  )];

  const currentFilesMap = (aiComParams.data.files ?? []).reduce((pre, cur) => {
    pre[cur.fileName] = cur;
    return pre;
  }, {});

  const deleteFileNames = new Set<string>();

  for (const fileName of fileNames) {
    const matchedFiles = files.filter((f) => f.fileName === fileName);
    if (matchedFiles.length === 0) continue;

    const dataKey = fileName;

    if (matchedFiles.length === 1) {
      if (matchedFiles[0].language === "delete") {
        deleteFileNames.add(matchedFiles[0].fileName);
        fileResults.push({
          fileName,
          dataKey,
          fullReplace: true,
          replaceCount: 1,
          results: [{ ok: true, strategy: 'delete' }],
          success: true,
        });
        continue;
      }

      fileResults.push({
        fileName,
        dataKey,
        fullReplace: true,
        replaceCount: 1,
        results: [{ ok: true, strategy: 'fullReplace' }],
        success: true,
      });
      pendingWrites.push({ fileName, content: matchedFiles[0].content });
      continue;
    }

    const current = decodeURIComponent(currentFilesMap[fileName]?.source || '');
    const operations: Array<{ before: string; after: string }> = [];
    for (let i = 0; i < matchedFiles.length; i += 2) {
      const before = matchedFiles[i];
      const after = matchedFiles[i + 1];
      if (!after) continue;
      operations.push({ before: before.content, after: after.content });
    }

    const multi = multiReplaceFile(current, operations);
    if (!multi.ok && multi.results.length > 0) {
      const firstFail = multi.results.find((r) => !r.ok);
      if (firstFail?.message) {
        // console.error(`[@开发模块 - 文件${fileName} 替换失败]`, firstFail.message);
      }
    }

    fileResults.push({
      fileName,
      dataKey,
      fullReplace: false,
      replaceCount: multi.results.length,
      results: multi.results,
      success: multi.ok,
    });
    if (multi.ok && multi.newContent !== undefined) {
      pendingWrites.push({ fileName, content: multi.newContent });
    }
  }

  const mergeSuccess = fileResults.every((r) => r.success);
  if (mergeSuccess) {
    pendingWrites.forEach(({ fileName, content }) =>
      context.updateFile({ fileName, content })
    );
    deleteFileNames.forEach((fileName) => {
      context.updateFile({ fileName, type: "delete" });
    });
    aiComParams.data.document = '';
  }

  // 收集编译/校验错误（来自 data._errors，只取本次涉及文件的错误）
  const updatedFileNames = new Set([
    ...pendingWrites.map((f) => f.fileName),
    ...deleteFileNames,
  ]);
  const rawErrors: Array<{ file: string; message: string; type?: string }> =
    aiComParams.data._errors ?? [];
  const compileErrors = rawErrors
    .filter((e) => updatedFileNames.has(e.file))
    .map((e) => ({
      file: e.file,
      message: e.message,
      type: (e.type === 'validate' ? 'validate' : 'compile') as 'compile' | 'validate',
    }));

  const compileSuccess = compileErrors.length === 0;

  return {
    comId,
    fileResults,
    mergeSuccess,
    compileErrors,
    compileSuccess,
    success: mergeSuccess && compileSuccess,
    updateFile: !!(mergeSuccess && (pendingWrites.length || deleteFileNames.size))
  };
}

export { formatUpdateResult, updateComponentFiles };
export type { ReplaceResultItem, UpdateComponentFilesResult };