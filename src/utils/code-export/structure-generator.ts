import codeTransform from './codeTransform';
import utilsFiles from './utilsFiles';

/**
 * 代码结构生成器
 * 负责将组件数据按照代码结构生成并组织文件
 */

export interface FileItem {
  /** 文件名（包含相对路径，如 runtime.jsx） */
  fileName: string;
  /** 文件内容 */
  content: string;
}

export interface ComponentData {
  /** 运行时 JSX 源码 */
  runtimeJsxSource?: string;
  /** 样式源码（LESS） */
  styleSource?: string;
  /** Store 源码 */
  storeJsSource?: string;
  /** 其他元数据 */
  [key: string]: any;
}

/**
 * 生成代码文件结构
 * 只导出三个核心文件：runtime.jsx, style.less, store.js
 */
export function generateCodeStructure(data: ComponentData): FileItem[] {
  const files: FileItem[] = [];

    const { runtimeJsxSource, storeJsSource, serviceJsSource, styleSource } = data;

    const codeFiles = codeTransform({
      runtime: decodeURIComponent(runtimeJsxSource || ""),
      store: decodeURIComponent(storeJsSource || ""),
      service: decodeURIComponent(serviceJsSource || ""),
      style: decodeURIComponent(styleSource || ""),
    }).map((file) => {
      return {
        fileName: `${file.path}`,
        content: file.content,
      }
    })

    files.push(...codeFiles);

    files.push(...utilsFiles.map((file) => {
      return {
        fileName: `utils/${file.path}`,
        content: file.content,
      }
    }))

    return files;

  // const files: FileItem[] = [];

  // // 1. 生成 runtime.jsx
  // if (data.runtimeJsxSource) {
  //   files.push({
  //     fileName: 'runtime.jsx',
  //     content: decodeURIComponent(data.runtimeJsxSource),
  //   });
  // }

  // // 2. 生成 style.less
  // if (data.styleSource) {
  //   files.push({
  //     fileName: 'style.less',
  //     content: decodeURIComponent(data.styleSource),
  //   });
  // }

  // // 3. 生成 store.js
  // if (data.storeJsSource) {
  //   files.push({
  //     fileName: 'store.js',
  //     content: decodeURIComponent(data.storeJsSource),
  //   });
  // }

  // return files;
}

/**
 * 验证文件结构
 */
export function validateFileStructure(files: FileItem[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 检查必需文件
  const hasRuntime = files.some((f) => f.fileName === 'runtime.jsx');
  const hasStyle = files.some((f) => f.fileName === 'style.less');

  if (!hasRuntime) {
    errors.push('缺少必需文件: runtime.jsx');
  }

  if (!hasStyle) {
    errors.push('缺少必需文件: style.less');
  }

  // 检查文件路径合法性
  files.forEach((file) => {
    if (!file.fileName || file.fileName.includes('..')) {
      errors.push(`非法文件路径: ${file.fileName}`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
