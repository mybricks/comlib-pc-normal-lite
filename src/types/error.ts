/**
 * 组件错误统一数据结构
 */
export interface ComponentError {
  /** 错误所属文件，如 'runtime.jsx', 'style.less', 'store.js'；运行时错误无此字段 */
  file?: string;
  /** 错误信息 */
  message: string;
  /** 错误类型：compile-编译错误，runtime-运行时错误 */
  type: 'compile' | 'runtime';
}

/**
 * 组件数据中的错误列表
 * 
 * 使用方式：
 * - 添加错误：data._errors.push({ file: 'runtime.jsx', message: '...', type: 'compile' })
 * - 清除特定文件错误：data._errors = data._errors.filter(err => err.file !== 'runtime.jsx')
 * - 清除运行时错误：data._errors = data._errors.filter(err => err.file)
 */
export type ComponentErrors = ComponentError[];
