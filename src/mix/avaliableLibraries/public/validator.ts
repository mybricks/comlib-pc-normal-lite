import type { LibraryValidator, ValidateContext, ValidationError } from '../types';

/**
 * 内置依赖白名单（由平台注入，无需安装）。
 * 这些依赖由 MyBricks 运行时提供，可直接使用。
 */
const BUILTIN_LIBRARIES: readonly string[] = [
  'mybricks',
  'style.less',
  './style.less',
  'service',
  './service'
];

/**
 * 允许使用的三方库白名单（完整 import source 字符串）。
 * 新增允许库时在此追加。
 */
const THIRD_PARTY_LIBRARIES: readonly string[] = [
  'react',
  'react-dom',
  'antd',
  '@ant-design/icons',
  'echarts-for-react',
  'dayjs',
];

/** 合并所有允许的库（内置 + 三方） */
const ALLOWED_LIBRARIES: readonly string[] = [
  ...BUILTIN_LIBRARIES,
  ...THIRD_PARTY_LIBRARIES,
];


/**
 * 判断 import source 是否属于白名单中某个库的子路径。
 */
function isAllowed(source: string): boolean {
  return ALLOWED_LIBRARIES.some(
    (lib) => source === lib
  );
}

/**
 * 公共校验器：检测代码中是否使用了不在允许列表中的三方依赖。
 *
 * 采用 AST 层（validatePlugin）精确扫描所有 import 语句，
 */
const validator: LibraryValidator = {
  /**
   * libraryName 设为特殊占位符；本校验器不针对单一库，
   * 而是对所有 import 做白名单检查，所以 libraryName 仅用于日志标识。
   */
  libraryName: '__public__',

  /**
   * 【AST 层】精确扫描所有 ImportDeclaration 节点，
   * 对非白名单的 import source 抛出编译错误（与其他 plugin 体验一致）。
   */
  validatePlugin(_ctx: ValidateContext) {
    return function publicDepsValidatorPlugin(_babel: any) {
      return {
        visitor: {
          ImportDeclaration(path: any) {
            const source: string = path.node.source.value;

            if (isAllowed(source)) return;

            throw path.buildCodeFrameError(
              `[依赖校验] 使用了不允许的依赖：'${source}'\n` +
              `修正建议：请仅使用允许的依赖库。${ALLOWED_LIBRARIES.join('、')}`
            );
          },
        },
      };
    };
  },
};

export default validator;
