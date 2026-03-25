import type { LibraryValidator, ValidationError } from '../types';

/**
 * dayjs 库校验器（占位实现）。
 * 后续可在此处添加 dayjs 用法校验等。
 */
const validator: LibraryValidator = {
  libraryName: 'dayjs',

  validate(_code: string): ValidationError[] {
    return [];
  },
};

export default validator;
