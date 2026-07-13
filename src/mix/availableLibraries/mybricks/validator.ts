import type { LibraryValidator, ValidateContext } from '../types';

const LIBRARY_NAME = 'mybricks'
// const FIX_HINT = `修正建议：请参考 ${LIBRARY_NAME} 可用图标列表`

const VALID_NAMES = new Set([
  'appRef',
  'comRef',
  'popupRef',
  'pageRef',
  'Routes',
  'Route',
  'useLocation',
  'useNavigate',
  'useParams',
  'logger',
  'makeAutoObservable',
  '_collectDebugLogs',
  'PopupVisible',
  'useDesignToken',
  '_refreshPopups',
  'DataSource',
  'defineConfig',
  'useCardApis',
  'useCardAction',
  'defineTool'
])

// ── 校验器实现 ────────────────────────────────────────────────────────────────

const validator: LibraryValidator = {
  libraryName: LIBRARY_NAME,

  validatePlugin(_ctx: ValidateContext) {
    return function mybricksValidatorPlugin(_babel: any) {
      return {
        visitor: {
          // ── 静态 import 校验 ──────────────────────────────────────────
          ImportDeclaration(path: any) {
            if (path.node.source.value !== LIBRARY_NAME) return;

            path.node.specifiers.forEach((spec: any) => {
              // 只处理具名导入（ImportSpecifier）
              if (spec.type !== 'ImportSpecifier') return;
              const name: string = spec.imported?.name ?? spec.imported?.value ?? '';
              if (!name || VALID_NAMES.has(name)) return;

              throw path.buildCodeFrameError(
                `[mybricks 校验] 导入无效依赖，mybricks 未提供 '${name}'`
              );
            });
          },
        },
      };
    };
  },
};

export default validator;
