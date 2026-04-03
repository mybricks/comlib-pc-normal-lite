import type { ReplaceResultItem } from "../../../utils/editReplace";

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

export { formatUpdateResult };
export type { UpdateComponentFilesResult };