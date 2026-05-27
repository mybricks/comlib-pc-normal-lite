/**
 * Babel 插件：识别从 'mybricks' 导入的 logger，在每次 logger.xxx() 调用末尾追加两个参数：
 *
 * 1. 字符串字面量 '__logger__'
 * 2. 一个对象，包含当前调用的文件名与代码行范围，格式如下：
 *    { path: "<fileName>", start_line: <n>, end_line: <n> }
 *
 * 示例：
 *   logger.error('xx', error)
 *   → logger.error('xx', error, '__logger__', { path: "src/foo.ts", start_line: 5, end_line: 5 })
 *
 * 只在 logger 确实从 'mybricks' 导入时生效（命名导入 or 默认导入后解构均支持）。
 */

const MYBRICKS_SOURCE = 'mybricks';
const LOGGER_MARKER = '__logger__';

export default function loggerPlugin({ fileName }: { fileName?: string } = {}) {
  return function ({ types: t }: { types: any }) {
    /** 收集当前文件中所有代表 mybricks logger 的本地名称 */
    const loggerLocalNames = new Set<string>();

    return {
      visitor: {
        // ─── 1. 收集 import { logger } from 'mybricks' 或 import logger from 'mybricks' ───
        ImportDeclaration(path: any) {
          try {
            const { node } = path;
            if (node.source.value !== MYBRICKS_SOURCE) return;

            node.specifiers.forEach((specifier: any) => {
              // import { logger } from 'mybricks'
              if (
                t.isImportSpecifier(specifier) &&
                (specifier.imported?.name === 'logger' ||
                  specifier.imported?.value === 'logger')
              ) {
                loggerLocalNames.add(specifier.local.name);
              }
            });
          } catch { /* 静默处理解析错误 */ }
        },

        // ─── 2. 对 logger.xxx(...) 的 CallExpression 追加两个参数 ───
        CallExpression(path: any) {
          try {
            const { node } = path;
            const { callee } = node;

            // 只处理 logger.xxx() 形式的成员调用
            if (!t.isMemberExpression(callee)) return;

            const object = callee.object;
            if (!t.isIdentifier(object)) return;

            // 确认调用对象是已知 logger 本地名称
            if (!loggerLocalNames.has(object.name)) return;

            // 防止重复注入（幂等保护）：末尾已有 '__logger__' 字符串则跳过
            const args: any[] = node.arguments;
            if (
              args.length >= 2 &&
              t.isStringLiteral(args[args.length - 2]) &&
              args[args.length - 2].value === LOGGER_MARKER
            ) {
              return;
            }

            // ── 构建位置信息对象 ──
            const loc = node.loc;
            const startLine: number = loc?.start?.line ?? 0;
            const endLine: number = loc?.end?.line ?? startLine;

            const locationObject = t.objectExpression([
              t.objectProperty(
                t.identifier('path'),
                t.stringLiteral(fileName ?? '')
              ),
              t.objectProperty(
                t.identifier('start_line'),
                t.numericLiteral(startLine)
              ),
              t.objectProperty(
                t.identifier('end_line'),
                t.numericLiteral(endLine)
              ),
            ]);

            // 追加两个参数
            node.arguments.push(t.stringLiteral(LOGGER_MARKER));
            node.arguments.push(locationObject);
          } catch { /* 静默处理变换错误 */ }
        },
      },
    };
  };
}
