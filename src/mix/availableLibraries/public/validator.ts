import type { LibraryValidator, ValidateContext } from '../types';

/**
 * 内置依赖白名单（由平台注入，无需安装）。
 */
const BUILTIN_LIBRARIES: readonly string[] = [
  'mybricks',
  'style.less',
  './style.less',
  'service',
  './service'
];

/** react/react-dom 始终允许，与具体注册的三方库无关 */
const ALWAYS_ALLOWED: readonly string[] = ['react', 'react-dom'];

/**
 * 创建公共依赖校验器。
 * @param thirdPartyLibNames 允许使用的三方库名称列表，由 index.ts 从 BUILTIN_LIBS 派生后传入
 */
export function createPublicValidator(thirdPartyLibNames: string[]): LibraryValidator {
  const ALLOWED_LIBRARIES: readonly string[] = [
    ...BUILTIN_LIBRARIES,
    ...ALWAYS_ALLOWED,
    ...thirdPartyLibNames,
  ];

  function isAllowed(source: string): boolean {
    return ALLOWED_LIBRARIES.some((lib) => source === lib);
  }

  return {
    libraryName: '__public__',

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
}

export default createPublicValidator;
