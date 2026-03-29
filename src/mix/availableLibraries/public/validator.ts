import type { LibraryValidator, ValidateContext } from '../types';

/**
 * 内置依赖白名单（由平台注入，无需安装）。
 */
const BUILTIN_LIBRARIES: readonly string[] = [
  'mybricks',
  'mybricks/testing',
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

    validatePlugin(ctx: ValidateContext) {
      const fileName = ctx.fileName ?? '';
      const isSetupJs = fileName === 'setup.js';
      const isDataSourceJs = fileName === 'dataSource.js';

      return function publicDepsValidatorPlugin(_babel: any) {
        return {
          visitor: {
            ImportDeclaration(path: any) {
              const source: string = path.node.source.value;

              // ── dataSource.js：禁止直接引入 axios ───────────────────────
              if (isDataSourceJs && (source === 'axios' || source.startsWith('axios/'))) {
                throw path.buildCodeFrameError(
                  `[dataSource.js 校验] 禁止在 dataSource.js 中直接引入 'axios'。\n` +
                  `修正建议：请使用 DataSource 基类内置的 this.axios 发起请求，无需单独安装或导入 axios。`
                );
              }

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

              // ── setup.js：spyOn 只允许 .mockReturn 链式调用 ──────────────
              if (isSetupJs) {
                // 检测 spyOn(...).xxx() 中 xxx 不是 mockReturn 的情况
                if (
                  callee.type === 'MemberExpression' &&
                  callee.property.type === 'Identifier' &&
                  callee.property.name !== 'mockReturn'
                ) {
                  const obj = callee.object;
                  if (
                    obj.type === 'CallExpression' &&
                    obj.callee.type === 'Identifier' &&
                    obj.callee.name === 'spyOn'
                  ) {
                    throw path.buildCodeFrameError(
                      `[setup.js 校验] spyOn 只支持 .mockReturn() 方法，不允许使用 '.${callee.property.name}'。\n` +
                      `修正建议：请使用 spyOn(dataSource, 'method').mockReturn(value) 形式。`
                    );
                  }
                }
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

            // ── 统一 Program 入口：全局规则 + 文件专属规则 ──────────────────
            Program: {
              enter(programPath: any) {
                // ── 全局：React APIs 白名单，必须从 'react' 导入 ─────────────
                const REACT_APIS = new Set([
                  'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
                  'useContext', 'useReducer', 'useLayoutEffect', 'useImperativeHandle',
                  'useDebugValue', 'useId', 'useDeferredValue', 'useTransition',
                  'useInsertionEffect', 'useSyncExternalStore',
                  'createContext', 'forwardRef', 'memo', 'createElement',
                  'Fragment', 'Children', 'cloneElement', 'isValidElement',
                ]);

                // 收集各来源的导入绑定
                const importedFromReact = new Set<string>();
                const importedLogger = new Set<string>();
                const importedFromTesting = new Set<string>();
                let hasDataSourceImport = false;

                programPath.traverse({
                  ImportDeclaration(imp: any) {
                    const src: string = imp.node.source.value;
                    for (const spec of imp.node.specifiers) {
                      if (spec.type !== 'ImportSpecifier') continue;
                      const imported: string = spec.imported.name;
                      const local: string = spec.local.name;

                      if (src === 'react' && REACT_APIS.has(imported)) {
                        importedFromReact.add(local);
                      }
                      if (src === 'mybricks' && imported === 'logger') {
                        importedLogger.add(local);
                      }
                      if (isSetupJs && src === 'mybricks/testing' &&
                        (imported === 'describe' || imported === 'spyOn')) {
                        importedFromTesting.add(local);
                      }
                      if (isDataSourceJs && src === 'mybricks' && imported === 'DataSource') {
                        hasDataSourceImport = true;
                      }
                    }
                  },
                });

                // ── dataSource.js：必须从 mybricks 引入 DataSource ───────────
                if (isDataSourceJs && !hasDataSourceImport) {
                  throw programPath.buildCodeFrameError(
                    `[dataSource.js 校验] 必须从 'mybricks' 中导入 DataSource 基类。\n` +
                    `修正建议：import { DataSource } from 'mybricks'`
                  );
                }

                // ── dataSource.js：只能有一个 export default ─────────────────
                if (isDataSourceJs) {
                  let exportDefaultCount = 0;
                  programPath.traverse({
                    ExportDefaultDeclaration() { exportDefaultCount++; },
                  });
                  if (exportDefaultCount === 0) {
                    throw programPath.buildCodeFrameError(
                      `[dataSource.js 校验] 必须有且只有一个 export default 导出（应为 export default new MyDatasource()）。`
                    );
                  }
                  if (exportDefaultCount > 1) {
                    throw programPath.buildCodeFrameError(
                      `[dataSource.js 校验] 只能有一个 export default 导出，当前发现 ${exportDefaultCount} 个。`
                    );
                  }
                }

                // ── 标识符引用校验 ───────────────────────────────────────────
                programPath.traverse({
                  ReferencedIdentifier(refPath: any) {
                    const name: string = refPath.node.name;

                    // React APIs 必须从 'react' 引入
                    if (REACT_APIS.has(name)) {
                      const binding = refPath.scope.getBinding(name);
                      if (binding && importedFromReact.has(name)) return;
                      // 有绑定但来源不对，或全局使用
                      throw refPath.buildCodeFrameError(
                        `[依赖校验] '${name}' 必须从 'react' 中导入后使用。\n` +
                        `修正建议：import { ${name} } from 'react'`
                      );
                    }

                    // logger 必须从 'mybricks' 引入
                    if (name === 'logger') {
                      const binding = refPath.scope.getBinding(name);
                      if (binding && importedLogger.has(name)) return;
                      throw refPath.buildCodeFrameError(
                        `[依赖校验] 'logger' 必须从 'mybricks' 中导入后使用。\n` +
                        `修正建议：import { logger } from 'mybricks'`
                      );
                    }

                    // setup.js：describe / spyOn 必须从 'mybricks/testing' 引入
                    if (isSetupJs && (name === 'describe' || name === 'spyOn')) {
                      const binding = refPath.scope.getBinding(name);
                      if (binding && importedFromTesting.has(name)) return;
                      throw refPath.buildCodeFrameError(
                        `[setup.js 校验] '${name}' 必须从 'mybricks/testing' 中导入后使用。\n` +
                        `修正建议：import { describe, spyOn } from 'mybricks/testing'`
                      );
                    }
                  },
                });
              },
            },
          },
        };
      };
    },
  };
}

export default createPublicValidator;
