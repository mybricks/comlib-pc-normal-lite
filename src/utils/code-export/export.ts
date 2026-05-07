/**
 * 代码导出工具
 * 自动检测环境：VSCode 或浏览器
 */

import type { FileItem } from './structure-generator';

export interface ExportProgress {
  /** 当前进度（0-100） */
  progress: number;
  /** 当前处理的文件 */
  currentFile?: string;
  /** 总文件数 */
  totalFiles: number;
  /** 已完成文件数 */
  completedFiles: number;
}

export interface ExportOptions {
  /** 文件夹名称 */
  folderName?: string;
  /** 上次已选择的目标目录路径（仅 VSCode 环境有效），传入后跳过目录选择弹窗直接写入 */
  outputDir?: string;
  /** 进度回调 */
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * 导出代码文件
 * 自动检测环境：优先使用 VSCode，否则使用浏览器 API
 */
/**
 * 导出代码文件
 * 自动检测环境：优先使用 VSCode，否则使用浏览器 API
 * VSCode 环境下返回本次实际使用的导出目录路径，浏览器环境下返回 undefined
 */
export async function exportCode(
  files: FileItem[],
  options: ExportOptions = {}
): Promise<string | undefined> {
  const { folderName = 'mybricks-component', outputDir, onProgress } = options;

  // 检查是否在 VSCode 环境
  const exportCodeToVSCode = (window as any).exportCodeToVSCode;
  if (typeof exportCodeToVSCode === 'function') {
    // 使用 VSCode 导出，返回实际使用的目录路径
    // console.log('[代码导出] 使用 VSCode 导出');
    const usedDir: string = await exportCodeToVSCode(files, { folderName, outputDir, onProgress });
    return usedDir;
  }

  // 检查浏览器是否支持文件系统 API
  if (!('showDirectoryPicker' in window)) {
    throw new Error(
      '当前浏览器不支持文件系统 API，请使用 Chrome、Edge 或其他支持的浏览器'
    );
  }

  // 使用浏览器文件系统 API 导出
  // console.log('[代码导出] 使用浏览器文件系统 API');
  
  try {
    // 1. 请求用户选择目录
    const directoryHandle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads',
    });

    // 2. 创建组件文件夹
    const componentDirHandle = await directoryHandle.getDirectoryHandle(folderName, {
      create: true,
    });

    // 3. 写入文件
    const totalFiles = files.length;
    let completedFiles = 0;

    for (const file of files) {
      await writeFile(componentDirHandle, file);
      completedFiles++;

      // 触发进度回调
      onProgress?.({
        progress: Math.round((completedFiles / totalFiles) * 100),
        currentFile: file.fileName,
        totalFiles,
        completedFiles,
      });
    }

    // console.log(`[浏览器导出] 成功导出 ${totalFiles} 个文件到: ${folderName}`);
  } catch (error) {
    // 用户取消选择
    if ((error as any).name === 'AbortError') {
      // console.log('[浏览器导出] 用户取消导出');
      throw new Error('用户取消导出');
    }
    throw error;
  }
  return undefined;
}

/**
 * 写入单个文件（支持嵌套目录）
 */
async function writeFile(
  rootDirHandle: FileSystemDirectoryHandle,
  file: FileItem
): Promise<void> {
  const pathParts = file.fileName.split('/').filter(Boolean);
  const fileName = pathParts.pop();

  if (!fileName) {
    throw new Error(`无效的文件路径: ${file.fileName}`);
  }

  // 创建嵌套目录
  let currentDirHandle = rootDirHandle;
  for (const dirName of pathParts) {
    currentDirHandle = await currentDirHandle.getDirectoryHandle(dirName, {
      create: true,
    });
  }

  // 创建文件
  const fileHandle = await currentDirHandle.getFileHandle(fileName, {
    create: true,
  });

  // 写入内容
  const writable = await fileHandle.createWritable();
  await writable.write(file.content);
  await writable.close();
}

/**
 * 检查是否支持导出
 */
export function isExportSupported(): boolean {
  // VSCode 环境或浏览器支持文件系统 API
  return (
    typeof (window as any).exportCodeToVSCode === 'function' ||
    'showDirectoryPicker' in window
  );
}
