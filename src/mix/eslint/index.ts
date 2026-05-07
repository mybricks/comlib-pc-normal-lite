/**
 * mix/eslint/index.ts
 *
 * 用 Babel 在浏览器端实现轻量 ESLint 规则校验。
 * verify() 对所有文件执行一次扫描，返回与 ESLint Linter.verify() 兼容的消息数组，
 * 不 throw、不阻塞编译。
 *
 * 架构：
 * - Pass 1：扫描 JSX 文件，提取 comRef/popupRef/appRef 节点信息
 * - Pass 2：按文件类型分别校验
 *   - JS/JSX 文件 → Babel AST 规则（no-console, no-window-location, require-datasource-async）
 *   - README.md → 格式校验 + 跨文件节点一致性校验（使用 context.ts 编译时产生的 ParsedSummary）
 *   - requirement.md → 文件存在性由 verify() 处理
 * - 文件存在性校验：检查 README.md / requirement.md 是否在文件列表中
 */

import type { LintMessage } from './types';
import type { ParsedSummary } from '../../utils/ai-code/md';
import { createNoConsoleRule } from './rules/no-console';
import { createNoWindowLocationRule } from './rules/no-window-location';
import { createRequireDatasourceAsyncRule } from './rules/require-datasource-async';
import { createExtractComRefsRule, type ComRefInfo } from './rules/extract-comrefs';
import { checkReadme, RULE_ID as README_RULE_ID } from './rules/readme';
import { checkRequirement, RULE_ID as REQ_RULE_ID } from './rules/requirement';

export type { LintMessage };

/**
 * 对单文件代码执行所有轻量 Babel 规则扫描。
 *
 * @param code     文件源码字符串（解码后的原始代码）
 * @param fileName 文件名，用于填充 LintMessage.fileName
 * @returns        与 ESLint LintMessage[] 兼容的消息数组
 */
export function verifyFile(code: string, fileName: string): LintMessage[] {
  if (!code || !code.trim()) return [];

  const Babel = (window as any).Babel;
  if (!Babel) {
    console.warn('[mix/eslint] window.Babel 未就绪，跳过 verify');
    return [];
  }

  const noConsole = createNoConsoleRule();
  const noWindowLocation = createNoWindowLocationRule();
  const isDataSourceFile = fileName.includes('dataSource');
  const requireDatasourceAsync = isDataSourceFile ? createRequireDatasourceAsyncRule() : null;

  try {
    Babel.transform(code, {
      presets: [
        ['env', { modules: 'commonjs' }],
        'react',
      ],
      plugins: [
        ['proposal-decorators', { legacy: true }],
        'proposal-class-properties',
        ['transform-typescript', { isTSX: true }],
        noConsole.plugin,
        noWindowLocation.plugin,
        ...(requireDatasourceAsync ? [requireDatasourceAsync.plugin] : []),
      ],
      retainLines: true,
    });
  } catch {
    // verify 阶段不关心语法错误（由编译阶段处理），忽略 throw
  }

  const messages: LintMessage[] = [
    ...noConsole.getMessages(),
    ...noWindowLocation.getMessages(),
    ...(requireDatasourceAsync?.getMessages() ?? []),
  ].map((msg) => ({ ...msg, fileName }));

  return messages;
}

/**
 * 从 JSX 文件中提取 comRef/popupRef/appRef 节点信息。
 *
 * @param code     文件源码字符串
 * @param fileName 文件名
 * @returns        ComRefInfo 数组
 */
function extractComRefs(code: string, fileName: string): ComRefInfo[] {
  const Babel = (window as any).Babel;
  if (!Babel) return [];

  const rule = createExtractComRefsRule(fileName);

  try {
    Babel.transform(code, {
      presets: [
        ['env', { modules: 'commonjs' }],
        'react',
      ],
      plugins: [
        ['proposal-decorators', { legacy: true }],
        'proposal-class-properties',
        ['transform-typescript', { isTSX: true }],
        rule.plugin,
      ],
      retainLines: true,
    });
  } catch {
    // 提取阶段不关心语法错误
  }

  return rule.getResults();
}

/**
 * 判断文件名是否为 JSX/JS 文件。
 */
function isJsxFile(fileName: string): boolean {
  return /\.(jsx|js|tsx|ts)$/.test(fileName) && !fileName.endsWith('.d.ts');
}

/**
 * 对文件列表执行全量轻量规则扫描。
 *
 * 架构：
 * - Pass 1：扫描所有 JSX/JS 文件，提取 comRef/popupRef/appRef 节点信息
 * - Pass 2：按文件类型分别校验
 * - 文件存在性校验：README.md / requirement.md 必须存在
 *
 * @param files 文件数组，每项包含 fileName、source（encodeURIComponent 编码）以及可选的 compiled
 *              对于 README.md，compiled 为 context.ts 写入时 parsemd() 产生的 ParsedSummary
 * @returns     所有文件的 LintMessage[] 聚合，按文件顺序排列
 */
export function verify(files: Array<{ fileName: string; source: string; compiled?: unknown }>): LintMessage[] {
  const results: LintMessage[] = [];

  // ─── 准备工作：解码文件内容 ───
  const decodedFiles: Array<{ fileName: string; code: string; compiled?: unknown }> = [];
  for (const file of files ?? []) {
    const fileName = typeof file?.fileName === 'string' ? file.fileName : '';
    const rawSource = typeof file?.source === 'string' ? file.source : '';
    if (!rawSource) continue;

    let code: string;
    try {
      code = decodeURIComponent(rawSource);
    } catch {
      code = rawSource;
    }

    decodedFiles.push({ fileName, code, compiled: file.compiled });
  }

  const fileNames = new Set(decodedFiles.map(f => f.fileName));

  // ─── 文件存在性校验 ───
  if (!fileNames.has('README.md')) {
    results.push({
      ruleId: README_RULE_ID,
      severity: 2,
      message: `[文档校验] 项目缺少 README.md 文件，必须包含此文件。`,
      line: 1,
      column: 0,
      fileName: 'README.md',
      nodeType: 'document',
    });
  }

  if (!fileNames.has('requirement.md')) {
    results.push({
      ruleId: REQ_RULE_ID,
      severity: 2,
      message: `[文档校验] 项目缺少 requirement.md 文件，必须包含此文件。`,
      line: 1,
      column: 0,
      fileName: 'requirement.md',
      nodeType: 'document',
    });
  }

  // ─── Pass 1：提取 comRef/popupRef/appRef 节点信息 ───
  const allComRefInfos: ComRefInfo[] = [];
  const jsxFiles = decodedFiles.filter(f => isJsxFile(f.fileName));
  for (const file of jsxFiles) {
    allComRefInfos.push(...extractComRefs(file.code, file.fileName));
  }

  // ─── Pass 2：按文件类型分别校验 ───
  for (const file of decodedFiles) {
    const { fileName, code, compiled } = file;

    // JS/JSX 文件 → Babel AST 规则
    if (isJsxFile(fileName)) {
      results.push(...verifyFile(code, fileName));
      continue;
    }

    // README.md → 格式校验 + 跨文件节点一致性校验
    // 优先使用 context.ts 编译时产生的 ParsedSummary（compiled），降级时实时解析
    if (fileName === 'README.md') {
      let parsedReadme: ParsedSummary | null = null;
      if (compiled && typeof compiled === 'object' && !Array.isArray(compiled)) {
        parsedReadme = compiled as ParsedSummary;
      }
      if (parsedReadme) {
        results.push(...checkReadme(parsedReadme, fileName, allComRefInfos));
      }
      continue;
    }

    // requirement.md → 仅文件存在性（已在上方处理）
    if (fileName === 'requirement.md') {
      results.push(...checkRequirement(code, fileName));
      continue;
    }
  }

  return results;
}
