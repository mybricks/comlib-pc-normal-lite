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

/** 禁止使用的 console 方法 */
const FORBIDDEN_CONSOLE_METHODS: readonly string[] = ['log', 'warn', 'error', 'info', 'debug'];

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
    return ALLOWED_LIBRARIES.some((lib) => source === lib) || source.startsWith(".");
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

            // ── console.log/warn/error 禁用 ───────────────────────────────
            CallExpression(path: any) {
              const callee = path.node.callee;

              // 检测 console.xxx(...)
              if (
                callee.type === 'MemberExpression' &&
                callee.object.type === 'Identifier' &&
                callee.object.name === 'console' &&
                callee.property.type === 'Identifier' &&
                FORBIDDEN_CONSOLE_METHODS.includes(callee.property.name)
              ) {
                throw path.buildCodeFrameError(
                  `[日志校验] 禁止使用 console.${callee.property.name}，请使用 mybricks 提供的 logger 工具。\n` +
                  `修正建议：import { logger } from 'mybricks'，然后使用 logger.info / logger.warn / logger.error 替代。`
                );
              }

              // 检测 window.location.assign/replace/href 赋值（CallExpression 侧）
              // window.location.assign(...) / window.location.replace(...)
              if (
                callee.type === 'MemberExpression' &&
                callee.object.type === 'MemberExpression' &&
                callee.object.object.type === 'Identifier' &&
                callee.object.object.name === 'window' &&
                callee.object.property.type === 'Identifier' &&
                callee.object.property.name === 'location' &&
                callee.property.type === 'Identifier' &&
                ['assign', 'replace', 'reload'].includes(callee.property.name)
              ) {
                throw path.buildCodeFrameError(
                  `[路由校验] 禁止直接调用 window.location.${callee.property.name}()，请使用 mybricks 提供的路由工具。\n` +
                  `修正建议：import { useNavigate } from 'mybricks'，然后使用 navigate(path) 进行页面跳转。`
                );
              }
            },

            // ── window.location.href = '...' 赋值禁用 ───────────────────
            AssignmentExpression(path: any) {
              const left = path.node.left;

              // 匹配 window.location = ... 或 window.location.href = ... 等
              if (left.type !== 'MemberExpression') return;

              const isWindowLocation =
                // window.location.xxx = ...
                (
                  left.object.type === 'MemberExpression' &&
                  left.object.object.type === 'Identifier' &&
                  left.object.object.name === 'window' &&
                  left.object.property.type === 'Identifier' &&
                  left.object.property.name === 'location'
                ) ||
                // window.location = ...
                (
                  left.object.type === 'Identifier' &&
                  left.object.name === 'window' &&
                  left.property.type === 'Identifier' &&
                  left.property.name === 'location'
                ) ||
                // location.href = ... / location.pathname = ...
                (
                  left.object.type === 'Identifier' &&
                  left.object.name === 'location'
                );

              if (isWindowLocation) {
                throw path.buildCodeFrameError(
                  `[路由校验] 禁止直接修改 window.location，请使用 mybricks 提供的路由工具。\n` +
                  `修正建议：import { useNavigate } from 'mybricks'，然后使用 navigate(path) 进行页面跳转。`
                );
              }
            },
          },
        };
      };
    },
  };
}

export default createPublicValidator;
