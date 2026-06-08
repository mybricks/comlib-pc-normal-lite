/**
 * ESM 语义预检插件
 *
 * 在 Babel 以 commonjs 模式编译之前，对源码做一次 ES Module 语义校验。
 * CommonJS 模式会把很多 ESM 语法错误"悄悄放过"（转成合法的赋值/require），
 * 导致用户写出有问题的代码却得不到任何提示。
 *
 * 当前检测项：
 * ① 多个 `export default` —— ESM 语法错误，CJS 下会变成覆盖赋值
 * ② 重复的具名 export —— `export { a }; export { a };` ESM 报错，CJS 静默覆盖
 *
 * 如需扩展新规则，在 visitor 中新增对应节点类型即可，错误统一 push 进 errors 数组，
 * 遍历结束后批量抛出，保证一次能看到所有问题。
 *
 * 错误报告使用 path.buildCodeFrameError(message) 生成带代码帧的错误，
 * 输出示例：
 *
 *   不允许有多个 export default，一个文件只能有一个默认导出 (1)
 *
 *   1 | export default function Foo() {}
 *   > 2 | export default function Bar() {}
 *       | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 */

export default function esmPreCheckPlugin() {
  return function ({ types: t }: { types: any }) {
    // 收集所有带代码帧的错误对象，遍历结束后统一抛出
    const errors: Error[] = [];
    let exportDefaultCount = 0;
    const namedExports = new Set<string>();

    return {
      visitor: {
        // ① 多个 export default
        ExportDefaultDeclaration(path: any) {
          exportDefaultCount++;
          if (exportDefaultCount > 1) {
            errors.push(
              path.buildCodeFrameError(
                '不允许有多个 export default，一个文件只能有一个默认导出',
                SyntaxError
              )
            );
          }
        },

        // ② 重复的具名 export
        ExportNamedDeclaration(path: any) {
          // export { a, b } 形式
          if (path.node.specifiers?.length) {
            for (const spec of path.node.specifiers) {
              const name: string = spec.exported?.name ?? spec.exported?.value;
              if (!name) continue;
              if (namedExports.has(name)) {
                errors.push(
                  path.buildCodeFrameError(
                    `具名导出 "${name}" 重复，一个模块中每个名称只能导出一次`,
                    SyntaxError
                  )
                );
              } else {
                namedExports.add(name);
              }
            }
          }

          // export const / export function 形式
          if (path.node.declaration) {
            const decl = path.node.declaration;
            let names: string[] = [];

            if (t.isVariableDeclaration(decl)) {
              names = decl.declarations
                .map((d: any) => d.id?.name)
                .filter(Boolean);
            } else if (
              t.isFunctionDeclaration(decl) ||
              t.isClassDeclaration(decl)
            ) {
              if (decl.id?.name) names = [decl.id.name];
            }

            for (const name of names) {
              if (namedExports.has(name)) {
                errors.push(
                  path.buildCodeFrameError(
                    `具名导出 "${name}" 重复，一个模块中每个名称只能导出一次`,
                    SyntaxError
                  )
                );
              } else {
                namedExports.add(name);
              }
            }
          }
        },
      },

      // 整棵 AST 遍历完成后统一抛出所有收集到的错误
      post() {
        if (errors.length === 0) return;

        // 将所有代码帧错误拼接成一条信息一起抛出
        const detail = errors.map((e) => e.message).join('\n\n');
        throw new SyntaxError(
          `[ESM 语义校验] 发现 ${errors.length} 个错误：\n\n${detail}`
        );
      },
    };
  };
}
