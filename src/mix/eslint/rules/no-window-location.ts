import type { LintMessage } from '../types';

export const RULE_ID = 'no-window-location';

/**
 * 检测两类 window.location 违规操作：
 * 1. CallExpression：window.location.assign/replace/reload(...)
 * 2. AssignmentExpression：window.location = ...、window.location.href = ...、location.href = ...
 *
 * 收集违规信息而不 throw，不阻塞编译。
 *
 * @returns { plugin, getMessages }
 */
export function createNoWindowLocationRule(): {
  plugin: (babel: any) => { visitor: Record<string, any> };
  getMessages: () => LintMessage[];
} {
  const messages: LintMessage[] = [];

  function plugin(_babel: any) {
    return {
      visitor: {
        CallExpression(path: any) {
          const callee = path.node.callee;
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
            const loc = path.node.loc;
            messages.push({
              ruleId: RULE_ID,
              severity: 1,
              message: `[路由校验] 禁止直接调用 window.location.${callee.property.name}()，请使用 mybricks 提供的路由工具。修正建议：import { useNavigate } from 'mybricks'，然后使用 navigate(path) 进行页面跳转。`,
              line: loc?.start?.line ?? 1,
              column: loc?.start?.column ?? 0,
              endLine: loc?.end?.line,
              endColumn: loc?.end?.column,
              nodeType: 'CallExpression',
            });
          }
        },

        AssignmentExpression(path: any) {
          const left = path.node.left;
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
            const loc = path.node.loc;
            messages.push({
              ruleId: RULE_ID,
              severity: 2,
              message: `[路由校验] 禁止直接修改 window.location，请使用 mybricks 提供的路由工具。修正建议：import { useNavigate } from 'mybricks'，然后使用 navigate(path) 进行页面跳转。`,
              line: loc?.start?.line ?? 1,
              column: loc?.start?.column ?? 0,
              endLine: loc?.end?.line,
              endColumn: loc?.end?.column,
              nodeType: 'AssignmentExpression',
            });
          }
        },
      },
    };
  }

  return { plugin, getMessages: () => messages };
}
