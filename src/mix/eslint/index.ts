/**
 * mix/eslint/index.ts
 *
 * 用 Babel 在浏览器端实现轻量 ESLint 规则校验。
 * verify() 对所有文件执行一次扫描，返回与 ESLint Linter.verify() 兼容的消息数组，
 * 不 throw、不阻塞编译。
 *
 * 架构：
 * - Pass 1：扫描 JSX 文件，提取 comRef/popupRef/appRef 节点信息
 * - Pass 1.5：基于 @mybricks JSDoc 注释校验（不依赖 README.md）
 * - Pass 2：按文件类型分别校验
 *   - JS/JSX 文件 → Babel AST 规则（no-console, no-window-location, require-datasource-async）
 *   - requirement.md → 文件存在性由 verify() 处理
 * - 文件存在性校验：检查 requirement.md 是否在文件列表中
 *
 * 注意：所有 comRef/popupRef/appRef 节点均通过 @mybricks JSDoc 注释描述，不再依赖 README.md。
 */

import type { LintMessage } from './types';
import { createNoConsoleRule, RULE_ID as NO_CONSOLE_RULE_ID } from './rules/no-console';
import { createNoWindowLocationRule, RULE_ID as NO_WINDOW_LOC_RULE_ID } from './rules/no-window-location';
import { createRequireDatasourceAsyncRule, RULE_ID as DS_ASYNC_RULE_ID } from './rules/require-datasource-async';
import { createRequireComRefRule, RULE_ID as REQUIRE_COM_REF_RULE_ID } from './rules/require-com-ref';
import { createExtractComRefsRule, type ComRefInfo } from './rules/extract-comrefs';
import { checkRequirement, RULE_ID as REQ_RULE_ID } from './rules/requirement';
import { checkJSDoc, RULE_ID as JSDOC_RULE_ID } from './rules/jsdoc';
import { getLowcodeViewStoreDatasource } from './monaco-language-service';
import type { MybricksJSDoc } from '../../utils/ai-code/plugins/utils/parseMybricksJSDoc';
import collectJsDocPlugin from '../../utils/ai-code/plugins/collectJsDocPlugin';
export { getLowcodeViewStoreDatasource };

export type { LintMessage };

/** 所有可用规则的 ruleId 常量 */
export const RULE_IDS = {
  NO_CONSOLE: NO_CONSOLE_RULE_ID,
  NO_WINDOW_LOCATION: NO_WINDOW_LOC_RULE_ID,
  REQUIRE_DATASOURCE_ASYNC: DS_ASYNC_RULE_ID,
  REQUIREMENT_CHECK: REQ_RULE_ID,
  JSDOC_CHECK: JSDOC_RULE_ID,
  REQUIRE_COM_REF: REQUIRE_COM_REF_RULE_ID,
} as const;

/**
 * 规则严重程度，与 ESLint 保持一致：
 * - `-1` / `'off'`  — 禁用
 * - `1`  / `'warn'` — 警告
 * - `2`  / `'error'`— 错误
 */
export type RuleSeverity = -1 | 1 | 2 | 'off' | 'warn' | 'error';

/** 与 ESLint config.rules 格式一致的规则配置表 */
export type RulesConfig = Record<string, RuleSeverity | [RuleSeverity, ...unknown[]]>;

/** 与 ESLint Linter.verify() 第二个参数对齐的配置对象 */
export interface VerifyConfig {
  rules?: RulesConfig;
}

/** 将 ESLint 风格的 severity 值归一化为数字 -1 / 1 / 2 */function normalizeSeverity(raw: RuleSeverity): -1 | 1 | 2 {
  if (raw === 'off') return -1;
  if (raw === 'warn') return 1;
  if (raw === 'error') return 2;
  return raw;
}

/** 从 RulesConfig 中解析某条规则的最终 severity（-1 = 禁用）*/
function getRuleSeverity(rules: RulesConfig, ruleId: string, defaultSeverity: 1 | 2): -1 | 1 | 2 {
  if (!(ruleId in rules)) return defaultSeverity;
  const entry = rules[ruleId];
  const raw: RuleSeverity = Array.isArray(entry) ? entry[0] : entry;
  return normalizeSeverity(raw);
}

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
    // console.warn('[mix/eslint] window.Babel 未就绪，跳过 verify');
    return [];
  }

  const noConsole = createNoConsoleRule();
  const noWindowLocation = createNoWindowLocationRule();
  const isDataSourceFile = fileName.includes('dataSource');
  const requireDatasourceAsync = isDataSourceFile ? createRequireDatasourceAsyncRule() : null;
  const requireComRef = createRequireComRefRule(fileName);

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
        requireComRef.plugin,
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
    ...requireComRef.getMessages(),
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
 * 从单个 JSX/JS 文件中提取 @mybricks JSDoc 注释（使用 collectJsDocPlugin）。
 *
 * @param code     文件源码字符串
 * @param fileName 文件名
 * @returns        Map<componentName, MybricksJSDoc>
 */
function extractJsDocs(code: string, fileName: string): Map<string, MybricksJSDoc> {
  const Babel = (window as any).Babel;
  if (!Babel) return new Map();

  const jsdocMap = new Map<string, MybricksJSDoc>();

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
        [collectJsDocPlugin, { result: jsdocMap, fileName }],
      ],
      retainLines: true,
    });
  } catch {
    // 提取阶段不关心语法错误
  }

  return jsdocMap;
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
 * @returns     所有文件的 LintMessage[] 聚合，按文件顺序排列
 */
export async function verify(
  files: Array<{ fileName: string; source: string; compiled?: unknown }>,
  config?: VerifyConfig,
): Promise<LintMessage[]> {
  const rules: RulesConfig = config?.rules ?? {};
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
  const reqSeverity = getRuleSeverity(rules, REQ_RULE_ID, 2);
  if (reqSeverity !== -1 && !fileNames.has('requirement.md')) {
    results.push({
      ruleId: REQ_RULE_ID,
      severity: reqSeverity,
      message: `[文档校验] 项目缺少 requirement.md 文件，必须包含此文件。`,
      line: 1,
      column: 0,
      fileName: 'requirement.md',
      nodeType: 'document',
    });
  }

  // ─── Pass 1：提取 comRef/popupRef/appRef 节点信息 ───
  const jsxFiles = decodedFiles.filter(f => isJsxFile(f.fileName));

  // 采集 JSDoc 注释（所有 comRef/popupRef/appRef 节点均必须包含 @mybricks JSDoc）
  const jsdocSeverity = getRuleSeverity(rules, JSDOC_RULE_ID, 2);
  const jsdocMapByFile = new Map<string, Map<string, MybricksJSDoc>>();

  const perFileComRefInfos = new Map<string, ComRefInfo[]>();
  for (const file of jsxFiles) {
    const comRefInfos = extractComRefs(file.code, file.fileName);
    perFileComRefInfos.set(file.fileName, comRefInfos);

    if (jsdocSeverity !== -1) {
      const jsdocMap = extractJsDocs(file.code, file.fileName);
      if (jsdocMap.size > 0) {
        jsdocMapByFile.set(file.fileName, jsdocMap);
      }
    }
  }

  let allComRefInfos: ComRefInfo[] = Array.from(perFileComRefInfos.values()).flat();

  // ─── Pass 1.5：JSDoc 校验（基于组件侧注释，不依赖 README.md）───
  // 所有 comRef/popupRef/appRef 节点均必须包含 @mybricks JSDoc 注释
  if (jsdocSeverity !== -1) {
    for (const [fileName, comRefInfos] of perFileComRefInfos) {
      if (!comRefInfos.length) continue;
      // 取该文件的 jsdocMap（若文件没有任何 JSDoc，传入空 Map，由 checkJSDoc 反向校验报错）
      const jsdocMap = jsdocMapByFile.get(fileName) ?? new Map<string, MybricksJSDoc>();
      const fileComRefInfos = allComRefInfos.filter(
        info => comRefInfos.some(r => r.name === info.name),
      );
      const msgs = checkJSDoc(jsdocMap, fileComRefInfos, fileName)
        .map(msg => ({ ...msg, severity: jsdocSeverity }));
      results.push(...msgs);
    }
  }

  // ─── Pass 2：按文件类型分别校验 ───
  for (const file of decodedFiles) {
    const { fileName, code } = file;

    // JS/JSX 文件 → Babel AST 规则
    if (isJsxFile(fileName)) {
      results.push(...verifyFile(code, fileName));
      continue;
    }

    // requirement.md → 内容校验
    if (fileName === 'requirement.md') {
      if (reqSeverity === -1) continue;
      const msgs = checkRequirement(code, fileName)
        .map(msg => ({ ...msg, severity: reqSeverity }));
      results.push(...msgs);
      continue;
    }
  }

  return results;
}
