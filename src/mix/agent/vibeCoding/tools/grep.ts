/**
 * grep - 在项目文件中按模式搜索内容（基于 CodeBase）
 */

import type { CodeBase } from '../codeBase';

export interface VirtualFile {
  path: string;
  getContent: () => string;
}

export interface GrepToolConfig {
  codeBase: CodeBase;
}

const NAME = 'grep';
(grep as any).toolName = NAME;

const DEFAULT_MAX_MATCHES = 50;

export default function grep(config: GrepToolConfig): any {
  const { codeBase } = config;

  return {
    name: NAME,
    displayName: '全文搜索',
    description: `在项目文件内容中按正则搜索。
- params.searchPattern 或 params.pattern: 正则表达式
- params.fileFilter: 可选，文件名 glob 过滤，如 "*.jsx"`,
    execute({
      params,
    }: {
      params?: { searchPattern?: string; pattern?: string; fileFilter?: string };
    }) {
      const searchPattern = params?.searchPattern ?? params?.pattern ?? '';
      const fileFilter = params?.fileFilter;

      if (!searchPattern) {
        return {
          llmContent: '请提供 searchPattern 或 pattern 参数。',
          displayContent: '全文搜索（缺少参数）',
        };
      }

      const results = codeBase.grep(searchPattern, fileFilter);
      const limited = results.slice(0, DEFAULT_MAX_MATCHES);
      const truncated = results.length > limited.length;

      const llmContent =
        limited.length > 0
          ? limited
              .map((r) => `- ${r.path}:${r.line} ${r.content.trim()}`)
              .join('\n') + (truncated ? `\n\n（仅显示前 ${DEFAULT_MAX_MATCHES} 条，共 ${results.length} 条）` : '')
          : `未找到匹配 "${searchPattern}" 的内容。`;

      return {
        llmContent,
        displayContent: `全文搜索（${results.length} 条）`,
      };
    },
  };
}
