import type { LibraryValidator, ValidationError } from '../types';

/**
 * @antv/g6 库校验器（占位实现）。
 * 后续可在此处添加 G6 图实例用法校验等。
 */
const validator: LibraryValidator = {
  libraryName: '@antv/g6',

  validate(_code: string): ValidationError[] {
    return [];
  },
};

export default validator;
