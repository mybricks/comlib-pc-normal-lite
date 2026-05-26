import context from '../../context'
import type { LibraryValidator, ValidateContext } from '../types';

/**
 * 内置依赖白名单（由平台注入，无需安装）。
 */
const BUILTIN_LIBRARIES: readonly string[] = [
  'mybricks',
  'mybricks/testing',
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

  function isAllowed(source: string, fileName: string): boolean {
    return ALLOWED_LIBRARIES.some((lib) => source === lib) || source.startsWith(".");
  }

  return {
    libraryName: '__public__',

    validatePlugin(ctx: ValidateContext) {
      const fileName = ctx.fileName ?? '';
      const isSetupJs = fileName === 'setup.ts';
      const isDataSourceJs = fileName === 'dataSource.ts';

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

              if (isAllowed(source, fileName)) return;

              throw path.buildCodeFrameError(
                `[依赖校验] 使用了不允许的依赖：'${source}'\n` +
                `修正建议：请仅使用允许的依赖库。${ALLOWED_LIBRARIES.join('、')}`
              );
            },

            // ── setup.js：spyOn 只允许 .mockReturn 链式调用 ──────────────
            // console.xxx 和 window.location 规则已移至 mix/eslint/ 轻量校验层，不再阻塞编译
            CallExpression(path: any) {
              const callee = path.node.callee;

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
