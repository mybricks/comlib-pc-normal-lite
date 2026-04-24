import type { LintMessage } from '../types';

export const RULE_ID = 'require-datasource-async';

/**
 * 检测 dataSource 文件中的方法是否为 async。
 * 规则：
 * 1. 文件名包含 dataSource
 * 2. 类继承自 DataSource
 * 3. 类方法必须是 async
 *
 * @returns { plugin, getMessages }
 */
export function createRequireDatasourceAsyncRule(): {
  plugin: (babel: any) => { visitor: Record<string, any> };
  getMessages: () => LintMessage[];
} {
  const messages: LintMessage[] = [];

  function plugin(_babel: any) {
    return {
      visitor: {
        ClassDeclaration(path: any) {
          // 检查是否继承自 DataSource
          const superClass = path.node.superClass;
          if (!superClass) return;

          const isDataSource =
            (superClass.type === 'Identifier' && superClass.name === 'DataSource') ||
            (superClass.type === 'MemberExpression' &&
              superClass.object.type === 'Identifier' &&
              superClass.object.name === 'mybricks' &&
              superClass.property.type === 'Identifier' &&
              superClass.property.name === 'DataSource');

          if (!isDataSource) return;

          // 遍历类中的方法
          const classBody = path.node.body;
          if (!classBody || classBody.type !== 'ClassBody') return;

          for (const node of classBody.body) {
            // 只检查普通方法定义（ClassMethod），不检查 constructor、static、getter/setter
            if (
              node.type !== 'ClassMethod' ||
              node.kind === 'constructor' ||
              node.kind === 'get' ||
              node.kind === 'set' ||
              node.static
            ) {
              continue;
            }

            // 检查是否为 async
            if (!node.async) {
              const methodName = node.key.type === 'Identifier' ? node.key.name : '<unknown>';
              const loc = node.loc;
              messages.push({
                ruleId: RULE_ID,
                severity: 2,
                message: `[数据源校验] dataSource 中的方法 "${methodName}" 必须声明为 async。请修改为 async ${methodName}() { ... }，并确保调用处使用 await。`,
                line: loc?.start?.line ?? 1,
                column: loc?.start?.column ?? 0,
                endLine: loc?.end?.line,
                endColumn: loc?.end?.column,
                nodeType: 'MethodDefinition',
              });
            }
          }
        },
      },
    };
  }

  return { plugin, getMessages: () => messages };
}
