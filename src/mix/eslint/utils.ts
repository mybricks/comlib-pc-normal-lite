/**
 * mix/eslint/utils.ts
 *
 * ESLint 规则的公共工具函数。
 */

/**
 * 从文件路径派生组件名：
 * - pages/HomePage/index.jsx → HomePage（index 文件取父文件夹名）
 * - components/SearchBar.jsx → SearchBar（直接文件取文件名去扩展名）
 *
 * 与 src/utils/ai-code/plugins/babelPlugin.ts 中的同名函数保持相同逻辑。
 */
export function deriveNameFromFilePath(filePath?: string): string {
  if (!filePath) return 'root';
  const parts = filePath.replace(/\\/g, '/').split('/');
  const last = parts[parts.length - 1];
  const stem = last.replace(/\.[^.]+$/, '');
  if (stem === 'index' && parts.length > 1) {
    return parts[parts.length - 2];
  }
  return stem || 'root';
}
