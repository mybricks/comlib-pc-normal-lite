/**
 * injectStyleInfoPlugin
 *
 * 一个 Babel 插件，在编译时向 `StyleSheet.create({...})` 每个 style block 的属性
 * 旁边注入 `_<propName>` 字段，直接写入对应样式内。
 *
 * 例如，源码：
 * ```ts
 * scrollView: {
 *   flex: 1,
 *   backgroundColor: '#0f0f14',
 * }
 * ```
 * 注入后：
 * ```ts
 * scrollView: {
 *   flex: 1,
 *   backgroundColor: '#0f0f14',
 *   _flex: { line, propStart, propEnd, valueStart, valueEnd },
 *   _backgroundColor: { line, propStart, propEnd, valueStart, valueEnd },
 *   _filename: '/path/to/style.ts',
 * }
 * ```
 *
 * 注入的位置信息（StylePropInfo）：
 *   - `line`：属性所在行号（1-based）
 *   - `propStart`：属性整体（key: value）在源文件中的起始字符偏移
 *   - `propEnd`：属性整体的结束字符偏移
 *   - `valueStart`：属性值的起始字符偏移
 *   - `valueEnd`：属性值的结束字符偏移
 *
 * 额外注入：
 *   - `_filename`：当前编译文件的路径（来自 Babel `state.filename`），供编辑器定位 patch 文件
 *
 * 设计要点：
 *   - 位置信息只存在于编译产物中，不修改源文件
 *   - 插件幂等：已存在 `_<propName>` key 则跳过该属性
 *   - 同文件多个 `StyleSheet.create` 调用独立处理
 *   - AST 构建逻辑统一由 stylePropInfoUtils 提供
 */

export type { StylePropInfo } from './stylePropInfoUtils';
import { injectPositionInfoIntoObjectExpression, injectFilenameIntoObjectExpression } from './stylePropInfoUtils';

/**
 * injectStyleInfoPlugin
 *
 * 用法（在 Babel transform 配置中）：
 * ```ts
 * import injectStyleInfoPlugin from './plugins/injectStyleInfoPlugin';
 * babel.transform(code, {
 *   plugins: [injectStyleInfoPlugin],
 *   filename: 'style.ts',
 * });
 * ```
 */
export default function injectStyleInfoPlugin() {
  return {
    visitor: {
      CallExpression(nodePath: any, state: any) {
        const callee = nodePath.node.callee;

        // 识别 StyleSheet.create(...)
        const isStyleSheetCreate =
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'StyleSheet' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'create';

        if (!isStyleSheetCreate) return;

        const args = nodePath.node.arguments;
        if (!args || args.length === 0) return;

        const firstArg = args[0];
        if (!firstArg || firstArg.type !== 'ObjectExpression') return;

        // 获取当前编译文件名（由 Babel state.filename 提供，去掉开头斜杠）
        const filename: string = (state?.filename ?? '').replace(/^\//, '');

        // 遍历每个 style key（如 scrollView、footerText 等）
        for (const prop of firstArg.properties) {
          if (prop.type === 'SpreadElement' || prop.type === 'RestElement') continue;
          if (prop.type !== 'ObjectProperty') continue;

          // style key 的值必须是 ObjectExpression，由共享函数处理注入
          injectPositionInfoIntoObjectExpression(prop.value);

          // 额外注入 _filename，标识该样式块来自哪个文件
          injectFilenameIntoObjectExpression(prop.value, filename);
        }
      },
    },
  };
}
