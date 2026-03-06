export { generateCodeStructure, validateFileStructure } from './structure-generator';
export type { FileItem, ComponentData } from './structure-generator';

export { exportCode, isExportSupported } from './export';
export type { ExportProgress, ExportOptions } from './export';

/**
 * 使用示例：
 * 
 * // 1. 生成文件结构（只包含 runtime.jsx, style.less, store.js）
 * const files = generateCodeStructure(componentData);
 * 
 * // 2. 导出（自动检测环境）
 * await exportCode(files, {
 *   folderName: 'my-component',
 *   onProgress: (progress) => {
 *     console.log(`导出进度: ${progress.progress}%`);
 *   },
 * });
 */
