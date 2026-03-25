import type { LibraryValidator, ValidationError } from '../types';

/**
 * antd 库校验器（占位实现）。
 * 后续可在此处添加 antd 组件合法性校验、API 用法校验等。
 */
const validator: LibraryValidator = {
  libraryName: 'antd',

  validate(_code: string): ValidationError[] {
    return [];
  },
};

export default validator;
