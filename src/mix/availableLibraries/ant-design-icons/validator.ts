import type { LibraryValidator, ValidateContext } from '../types';
import { ICON_NAMES } from './iconNames';

/**
 * @ant-design/icons 合法图标名称白名单。
 * 从 iconNames.ts 自动生成（源自 @ant-design/icons 仓库 src/icons 目录）。
 */
const VALID_ICON_NAMES: Set<string> = new Set(ICON_NAMES);

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 简单的相似图标推荐：找同基名（去掉 Filled/Outlined/TwoTone 后缀）的变体。
 * 无法匹配时做简短前缀模糊匹配（最多 3 个）。
 */
function getSimilarIcons(name: string): string[] {
  if (VALID_ICON_NAMES.size === 0) return [];

  const SUFFIXES = ['Filled', 'Outlined', 'TwoTone'];
  let base = name;
  for (const suffix of SUFFIXES) {
    if (name.endsWith(suffix)) {
      base = name.slice(0, -suffix.length);
      break;
    }
  }

  const similar: string[] = [];
  for (const suffix of SUFFIXES) {
    const candidate = base + suffix;
    if (VALID_ICON_NAMES.has(candidate)) similar.push(candidate);
  }

  if (similar.length === 0 && base.length >= 3) {
    const prefix = base.slice(0, 3).toLowerCase();
    for (const icon of VALID_ICON_NAMES) {
      if (icon.toLowerCase().startsWith(prefix) && similar.length < 3) similar.push(icon);
    }
  }

  return similar;
}

function buildFixHint(name: string): string {
  const similar = getSimilarIcons(name);
  return similar.length > 0
    ? `请从允许列表中选择。类似图标：${similar.join('、')}`
    : '请参考 @ant-design/icons 允许图标列表';
}

// ── 校验器实现 ────────────────────────────────────────────────────────────────

const validator: LibraryValidator = {
  libraryName: '@ant-design/icons',

  /**
   * 【AST 层】标准 Babel plugin factory，注入 transformTsx 的 plugins 数组。
   * 复用 window.Babel 的同一次 parse/transform，精确且零额外开销。
   * 通过闭包访问 ctx，支持多文件上下文（ctx.relatedFiles 可按需查询相关文件）。
   *
   * 覆盖两类场景：
   * 1. 静态 import：import { FakeIcon } from '@ant-design/icons'
   * 2. 动态字符串字面量：Icons['FakeIcon']（import * as Icons from '@ant-design/icons'）
   */
  validatePlugin(ctx: ValidateContext) {
    const onError = ctx.onError
    const reportError = (error: Error) => {
      if (onError) {
        onError(error)
        return
      }
      throw error
    }

    return function iconValidatorPlugin(_babel: any) {
      return {
        visitor: {
          // ── 静态 import 校验 ──────────────────────────────────────────
          ImportDeclaration(path: any) {
            if (path.node.source.value !== '@ant-design/icons') return;
            if (VALID_ICON_NAMES.size === 0) return;

            path.node.specifiers.forEach((spec: any) => {
              // 只处理具名导入（ImportSpecifier），跳过 import * as Icons 等
              if (spec.type !== 'ImportSpecifier') return;
              const name: string = spec.imported?.name ?? spec.imported?.value ?? '';
              if (!name || VALID_ICON_NAMES.has(name)) return;

              reportError(path.buildCodeFrameError(
                `[icon 校验] 不存在的 @ant-design/icons 图标：${name}\n修正建议：${buildFixHint(name)}`
              ));
            });
          },

          // ── 动态字符串字面量 Icons['XxxIcon'] 校验 ──────────────────
          MemberExpression(path: any) {
            if (VALID_ICON_NAMES.size === 0) return;
            if (!path.node.computed || path.node.property.type !== 'StringLiteral') return;

            const objectName: string = path.node.object.name ?? '';
            if (!objectName) return;

            // 通过 scope 绑定确认对象来自 import * as X from '@ant-design/icons'
            const binding = path.scope.getBinding(objectName);
            if (!binding) return;

            const bindingPath = binding.path;
            if (
              bindingPath.node.type === 'ImportNamespaceSpecifier' &&
              bindingPath.parent?.source?.value === '@ant-design/icons'
            ) {
              const name: string = path.node.property.value;
              if (!VALID_ICON_NAMES.has(name)) {
                reportError(path.buildCodeFrameError(
                  `[icon 校验] 动态访问了不存在的 @ant-design/icons 图标：${objectName}['${name}']\n修正建议：${buildFixHint(name)}`
                ));
              }
            }
          },
        },
      };
    };
  },
};

export default validator;
