/**
 * mix/eslint/index.ts
 *
 * 用 Babel 在浏览器端实现轻量 ESLint 规则校验。
 * verify() 对所有文件执行一次扫描，返回与 ESLint Linter.verify() 兼容的消息数组，
 * 不 throw、不阻塞编译。
 */

import type { LintMessage } from './types';
import { createNoConsoleRule } from './rules/no-console';
import { createNoWindowLocationRule } from './rules/no-window-location';

export type { LintMessage };

/**
 * 对单文件代码执行所有轻量规则扫描。
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
      ],
      retainLines: true,
    });
  } catch {
    // verify 阶段不关心语法错误（由编译阶段处理），忽略 throw
  }

  const messages: LintMessage[] = [
    ...noConsole.getMessages(),
    ...noWindowLocation.getMessages(),
  ].map((msg) => ({ ...msg, fileName }));

  return messages;
}

/**
 * 对文件列表执行全量轻量规则扫描。
 *
 * @param files 文件数组，每项包含 fileName 和 source（encodeURIComponent 编码后的代码）
 * @returns     所有文件的 LintMessage[] 聚合，按文件顺序排列
 */
export function verify(files: Array<{ fileName: string; source: string }>): LintMessage[] {
  const results: LintMessage[] = [];
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

    results.push(...verifyFile(code, fileName));
  }
  return results;
}
