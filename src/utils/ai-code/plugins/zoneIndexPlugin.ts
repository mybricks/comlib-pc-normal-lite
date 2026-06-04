/**
 * Babel 插件：为所有 JSX 标签按顺序打上索引标记。
 *
 * 写入两个属性：
 * - `data-zone-filename`：当前 JSX 所在文件名（由外部传入）
 * - `data-zone-index`：当前 AST 分析到的第几个 JSX 标签（从 1 开始自增）
 *
 * 最终可通过 `[data-zone-filename="xxx"][data-zone-index="N"]` 作为 selector 精准定位元素。
 *
 * 示例：
 *   文件名：src/components/Button/index.tsx
 *   输入：
 *     <div>
 *       <span>Hello</span>
 *     </div>
 *   输出：
 *     <div data-zone-filename="src/components/Button/index.tsx" data-zone-index="1">
 *       <span data-zone-filename="src/components/Button/index.tsx" data-zone-index="2">Hello</span>
 *     </div>
 */

export default function zoneIndexPlugin({ fileName }: { fileName?: string }) {
  return function ({ types: t }: { types: any }) {
    /** 每次调用插件重置计数器，保证同一文件内从 1 开始连续编号 */
    let zoneIndex = 0;

    return {
      visitor: {
        JSXOpeningElement(path: any) {
          try {
            const { node } = path;
            const attributes: any[] = node.attributes;

            // 幂等保护：已经注入过则跳过
            const alreadyInjected = attributes.some(
              (attr: any) =>
                attr.type === 'JSXAttribute' && attr.name?.name === 'data-zone-index'
            );
            if (alreadyInjected) return;

            zoneIndex += 1;

            // 注入 data-zone-filename
            if (fileName) {
              attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('data-zone-filename'),
                  t.stringLiteral(fileName)
                )
              );
            }

            // 注入 data-zone-index（值为字符串，与 HTML attribute 惯例保持一致）
            attributes.push(
              t.jsxAttribute(
                t.jsxIdentifier('data-zone-index'),
                t.stringLiteral(String(zoneIndex))
              )
            );
          } catch {
            // 静默处理解析错误
          }
        },
      },
    };
  };
}
