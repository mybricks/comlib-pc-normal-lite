/**
 * glob - 按 glob 模式列出项目内文件路径（基于 CodeBase）
 */

import type { CodeBase } from '../codeBase';

export interface VirtualFile {
  path: string;
  getContent: () => string;
}

export interface GlobToolConfig {
  codeBase: CodeBase;
}

const NAME = 'glob';
(glob as any).toolName = NAME;

export default function glob(config: GlobToolConfig): any {
  const { codeBase } = config;

  return {
    name: NAME,
    displayName: '文件列表',
    description: `按 glob 模式列出项目内文件路径。
- params.pattern: 如 "*.jsx"、"**/*.json"、"/runtime.jsx"`,
    execute({ params }: { params?: { pattern?: string } }) {
      const pattern = params?.pattern ?? '*';
      const paths = codeBase.glob(pattern);
      const llmContent =
        paths.length > 0
          ? `匹配 "${pattern}" 的文件：\n${paths.map((p) => `- ${p}`).join('\n')}`
          : `未找到匹配 "${pattern}" 的文件。当前文件：${codeBase.getFilePaths().join(', ')}`;

      return {
        llmContent,
        displayContent: `文件列表（${paths.length} 个）`,
      };
    },
  };
}
