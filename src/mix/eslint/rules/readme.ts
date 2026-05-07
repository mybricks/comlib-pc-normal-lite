import type { LintMessage } from '../types';
import type { ComRefInfo } from './extract-comrefs';
import type { ParsedSummary } from '../../../utils/ai-code/md';

export const RULE_ID = 'readme-check';

/**
 * README.md 文档规范校验规则。
 *
 * 涵盖两个层面：
 * 1. 格式校验：根节点存在性、节点必填字段（title/summary/type）
 * 2. 跨文件节点一致性校验：README 中的节点集合与 JSX 中的 comRef/popupRef/appRef 必须完全一致
 *
 * 解析工作由 context.ts 在文件写入时完成（parsemd），checkReadme 直接接收 ParsedSummary。
 * 文件存在性校验由 verify() 层面统一处理。
 *
 * @param parsed      已解析的 README 结构（由 context.ts parsemd 产生）
 * @param fileName    文件名（用于 LintMessage.fileName）
 * @param comRefInfos 从 JSX 文件提取的节点信息列表（用于跨文件一致性校验）
 * @returns           LintMessage 数组
 */
export function checkReadme(
  parsed: ParsedSummary,
  fileName: string,
  comRefInfos: ComRefInfo[],
): LintMessage[] {
  const messages: LintMessage[] = [];

  // ─── 1. 根节点存在性：必须有 "default" 键 ───
  if (!parsed['default']) {
    messages.push({
      ruleId: RULE_ID,
      severity: 2,
      message: `[文档校验] README.md 根节点必须为 "# default"。`,
      line: 1,
      column: 0,
      nodeType: 'heading',
    });
  }

  // ─── 2. 每个节点必须有 title、summary、type 字段 ───
  for (const [name, block] of Object.entries(parsed)) {
    if (!block.title) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${name}" 缺少 title 字段。`,
        line: 1,
        column: 0,
        nodeType: 'list',
      });
    }
    if (!block.summary) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${name}" 缺少 summary 字段。`,
        line: 1,
        column: 0,
        nodeType: 'list',
      });
    }
    if (!block.type) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${name}" 缺少 type 字段。`,
        line: 1,
        column: 0,
        nodeType: 'list',
      });
    }
  }

  // ─── 3. 跨文件节点一致性校验 ───
  const jsxNodeNames = new Set<string>(comRefInfos.map(info => info.name));
  const readmeNodeNames = new Set<string>(
    Object.keys(parsed).filter(name => name !== 'default')
  );

  // 3.1 README 中有但 JSX 中没有的节点
  for (const name of readmeNodeNames) {
    if (!jsxNodeNames.has(name)) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 节点 "${name}" 在源码中不存在。`,
        line: 1,
        column: 0,
        nodeType: 'heading',
      });
    }
  }

  // 3.2 JSX 中有但 README 中没有的节点
  for (const info of comRefInfos) {
    if (info.name === 'default') {
      // appRef 对应 README 的 "default" 根节点
      if (!parsed['default']) {
        messages.push({
          ruleId: RULE_ID,
          severity: 2,
          message: `[文档校验] JSX 中存在 appRef 根节点，但 README.md 缺少 "# default" 根节点。`,
          line: 1,
          column: 0,
          nodeType: 'heading',
        });
      }
      continue;
    }
    if (!readmeNodeNames.has(info.name)) {
      messages.push({
        ruleId: RULE_ID,
        severity: 2,
        message: `[文档校验] 源码中的 "${info.name}" 在文档中未声明。`,
        line: 1,
        column: 0,
        nodeType: 'heading',
      });
    }
  }

  return messages.map(msg => ({ ...msg, fileName }));
}
