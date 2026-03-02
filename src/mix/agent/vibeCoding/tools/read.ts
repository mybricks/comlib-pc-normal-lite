/**
 * read - 按路径与行区间读取文件（虚拟文件系统），并影响 CodeBase.exportToMessage 的展开区间
 */

import type { CodeBase } from '../codeBase';

export interface VirtualFile {
  path: string;
  getContent: () => string;
}

export interface ReadToolConfig {
  /** 使用 CodeBase 时，read 会更新其展开区间，供 exportToMessage 使用 */
  codeBase: CodeBase;
}

const NAME = 'read';
(read as any).toolName = NAME;

const DEFAULT_LIMIT = 100;

export default function read(config: ReadToolConfig): any {
  const { codeBase } = config;

  return {
    name: NAME,
    displayName: '读取文件',
    description: `按路径与行区间读取项目内文件内容。读取过的区间会在「项目空间」中展开显示。
- params.filePath 或 params.path: 文件路径，如 /runtime.jsx、/style.less
- params.offset: 起始行（1-based），默认 1
- params.limit: 最多读取行数，默认 ${DEFAULT_LIMIT}
大文件可分段读取，根据返回提示的 offset 继续。`,
    execute({
      params,
    }: {
      params?: { filePath?: string; path?: string; offset?: number; limit?: number };
    }) {
      const filePath = params?.filePath ?? params?.path ?? '';
      const offset = params?.offset ?? 1;
      const limit = params?.limit ?? DEFAULT_LIMIT;

      const path = filePath.startsWith('/') ? filePath : `/${filePath}`;
      const content = codeBase.getFileContent(path);
      if (content == null) {
        return {
          llmContent: `文件不存在: ${path}\n可用文件: ${codeBase.getFilePaths().join(', ')}`,
          displayContent: '读取文件（未找到）',
        };
      }

      const lines = content.split(/\r?\n/);
      const total = lines.length;
      const start = Math.max(1, offset);
      const end = Math.min(total, start + limit - 1);

      codeBase.read(filePath, { offset: start, limit: end - start + 1 });

      const nextHint =
        end < total ? ` 继续展开可从 offset=${end + 1} 开始。` : '';

      return {
        llmContent: `已展开 ${path} 第 ${start}-${end} 行（共 ${total} 行）。${nextHint}`,
        displayContent: `展开 ${path} L${start}-L${end}`,
      };
    },
  };
}
