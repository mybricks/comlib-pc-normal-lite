/**
 * Babel 插件：为可拖拽排序的 JSX 元素打上 `data-zone-order-editable` 标记。
 *
 * 功能说明：
 * - 遍历所有 JSXElement，判断其是否处于「动态列表」上下文（即 .map() 回调内）
 * - 处于 .map() 回调内的元素**不可拖**，不打标记（因为它们的数量/顺序由动态数据驱动）
 * - 其余元素视为静态布局，打上 `data-zone-order-editable` 属性
 *
 * `data-zone-order-editable` 值的格式（JSON 字符串）：
 * {
 *   start: number,       // JSX 元素在源码中的字符起始偏移
 *   end: number,         // JSX 元素在源码中的字符结束偏移（不含）
 *   startLine: number,   // JSX 元素起始行号（1-based）
 *   endLine: number,     // JSX 元素结束行号（1-based）
 *   startCol: number,    // JSX 元素起始列号（0-based）
 *   endCol: number,      // JSX 元素结束列号（0-based）
 * }
 *
 * 拖拽排序的消费侧逻辑：
 *   1. 拖动一个打了标记的 DOM 元素到目标位置
 *   2. 读取拖动元素（source）和目标相邻元素（target）上的 data-zone-order-editable
 *   3. 根据 start/end（字符偏移）在源码字符串中做区间替换，交换两段代码的位置
 *   4. 或根据 startLine/endLine（行号）按行分割后交换，再拼接回字符串
 *
 * 不可拖的情况（跳过注入）：
 * - 当前 JSXElement 的祖先链中存在 `.map((item) => ...)` 调用表达式
 *   （即由数据驱动 map 渲染的元素，顺序由数据决定，不允许静态拖拽排序）
 *
 * 示例：
 *   输入：
 *     <div>
 *       <Card title="A" />
 *       <Card title="B" />
 *       {list.map((item) => <Card title={item.title} />)}
 *     </div>
 *   输出（省略其他 data-* 属性）：
 *     <div data-zone-order-editable='{"start":0,"end":...,"startLine":1,"endLine":5,...}'>
 *       <Card title="A" data-zone-order-editable='{"start":...}' />
 *       <Card title="B" data-zone-order-editable='{"start":...}' />
 *       {list.map((item) => <Card title={item.title} />)}  ← 不打标记
 *     </div>
 */

/**
 * 判断当前路径是否处于 .map() 回调内部。
 * 向祖先链查找，遇到 CallExpression（callee 是 property name 为 "map" 的 MemberExpression）
 * 且当前节点处于其第一个参数（回调函数）内部时，返回 true。
 */
function isInsideMapCallback(path: any): boolean {
  let result = false;
  path.findParent((p: any) => {
    const n = p?.node;
    if (!n) return false;

    // 遇到函数边界（非箭头函数体）时继续向上，不阻断（.map 可能在外层）
    // 遇到 CallExpression 且为 .map(callback) 形式
    if (n.type === 'CallExpression') {
      const callee = n.callee;
      if (
        callee?.type === 'MemberExpression' &&
        callee?.property?.name === 'map'
      ) {
        // 确认当前 path 所在节点在此 CallExpression 的 arguments[0]（回调）内部
        const callback = n.arguments?.[0];
        if (callback) {
          // 通过 path 向上检查是否包含在 callback 节点范围内
          // Babel path.findParent 会在找到时停止，这里只要找到 map CallExpression 就视为在 map 内
          result = true;
          return true; // 停止向上查找
        }
      }
    }
    return false;
  });
  return result;
}

export interface ZoneOrderEditableInfo {
  /** JSX 元素在源码中的字符起始偏移 */
  start: number;
  /** JSX 元素在源码中的字符结束偏移（不含） */
  end: number;
  /** JSX 元素起始行号（1-based） */
  startLine: number;
  /** JSX 元素结束行号（1-based） */
  endLine: number;
  /** JSX 元素起始列号（0-based） */
  startCol: number;
  /** JSX 元素结束列号（0-based） */
  endCol: number;
}

export default function zoneOrderEditablePlugin() {
  return function ({ types: t }: { types: any }) {
    return {
      visitor: {
        JSXElement(path: any) {
          try {
            const { node } = path;
            const openingEl = node.openingElement;
            const attributes: any[] = openingEl.attributes;

            // 幂等保护：已注入则跳过
            const alreadyInjected = attributes.some(
              (attr: any) =>
                attr.type === 'JSXAttribute' &&
                attr.name?.name === 'data-zone-order-editable'
            );
            if (alreadyInjected) return;

            // 判断是否处于 .map() 动态列表回调内 —— 是则不可拖，跳过
            if (isInsideMapCallback(path)) return;

            // 收集源码位置信息
            // const start: number = node.start ?? 0;
            // const end: number = node.end ?? 0;
            // const startLine: number = node.loc?.start?.line ?? 1;
            // const endLine: number = node.loc?.end?.line ?? 1;
            // const startCol: number = node.loc?.start?.column ?? 0;
            // const endCol: number = node.loc?.end?.column ?? 0;

            // const info: ZoneOrderEditableInfo = {
            //   start,
            //   end,
            //   startLine,
            //   endLine,
            //   startCol,
            //   endCol,
            // };

            attributes.push(
              t.jsxAttribute(
                t.jsxIdentifier('data-zone-order-editable'),
                // t.stringLiteral(JSON.stringify(info))
                t.stringLiteral('1')
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
