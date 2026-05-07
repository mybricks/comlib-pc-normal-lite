import type { LintMessage } from '../types';

export const RULE_ID = 'requirement-check';

/**
 * requirement.md 校验规则。
 * 文件存在性校验由 verify() 层面统一处理，此处仅作占位。
 */
export function checkRequirement(_reqSource: string, _fileName: string): LintMessage[] {
  return [];
}
