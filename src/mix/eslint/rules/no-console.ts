import type { LintMessage } from '../types';

const FORBIDDEN_METHODS = ['log', 'warn', 'error', 'info', 'debug'] as const;

export const RULE_ID = 'no-console';

/**
 * 检测 console.log/warn/error/info/debug 调用。
 * 收集违规信息而不 throw，不阻塞编译。
 *
 * @returns { plugin, getMessages } plugin 注入 Babel，getMessages 在 transform 后读取结果
 */
export function createNoConsoleRule(): {
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
            callee.object.type === 'Identifier' &&
            callee.object.name === 'console' &&
            callee.property.type === 'Identifier' &&
            (FORBIDDEN_METHODS as readonly string[]).includes(callee.property.name)
          ) {
            const loc = path.node.loc;
            messages.push({
              ruleId: RULE_ID,
              severity: 1,
              message: `[日志校验] 禁止使用 console.${callee.property.name}，请使用 mybricks 提供的 logger 工具。修正建议：import { logger } from 'mybricks'，然后使用 logger.info / logger.warn / logger.error 替代。`,
              line: loc?.start?.line ?? 1,
              column: loc?.start?.column ?? 0,
              endLine: loc?.end?.line,
              endColumn: loc?.end?.column,
              nodeType: 'CallExpression',
            });
          }
        },
      },
    };
  }

  return { plugin, getMessages: () => messages };
}
