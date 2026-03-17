import type { LibraryValidator, ValidationError } from '../types';

/**
 * echarts-for-react 库校验器（占位实现）。
 * 后续可在此处添加 ECharts option 结构校验、组件用法校验等。
 */
const validator: LibraryValidator = {
  libraryName: 'echarts-for-react',

  validate(_code: string): ValidationError[] {
    return [];
  },
};

export default validator;
