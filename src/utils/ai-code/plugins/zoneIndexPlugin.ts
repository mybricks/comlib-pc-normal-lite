/**
 * Babel 插件：为所有 JSX 标签注入文件名标记。
 *
 * 写入属性：
 * - `data-zone-filename`：当前 JSX 所在文件名（由外部传入）
 *
 * 示例：
 *   文件名：src/components/Button/index.tsx
 *   输入：
 *     <div>
 *       <span>Hello</span>
 *     </div>
 *   输出：
 *     <div data-zone-filename="src/components/Button/index.tsx">
 *       <span data-zone-filename="src/components/Button/index.tsx">Hello</span>
 *     </div>
 */
import { pushDataAttr } from './utils';

export default function zoneIndexPlugin({ fileName, reactNative = false }: { fileName?: string; reactNative?: boolean }) {
  return function ({ types: t }: { types: any }) {
    return {
      visitor: {
        JSXOpeningElement(path: any) {
          try {
            const { node } = path;
            const attributes: any[] = node.attributes;

            // 幂等保护：已经注入过则跳过
            const alreadyInjected = attributes.some(
              (attr: any) =>
                attr.type === 'JSXAttribute' && attr.name?.name === 'data-zone-filename'
            );
            if (alreadyInjected) return;

            // 注入 data-zone-filename
            if (fileName) {
              pushDataAttr(attributes, 'data-zone-filename', fileName, {
                mode: reactNative ? 'react-native' : 'web',
              });
            }
          } catch {
            // 静默处理解析错误
          }
        },
      },
    };
  };
}
