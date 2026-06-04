/**
 * Babel 插件：分析 JSX 元素上的 style 属性，将各 key 是静态值还是动态值的信息
 * 写入 `data-style-info` 属性。
 *
 * 规则：
 * - 若 JSX 元素没有 `style` 属性，直接跳过
 * - 若有 `style` 属性，读取其 ObjectExpression 的每个 Property：
 *   - value 是字面量（StringLiteral / NumericLiteral / BooleanLiteral / NullLiteral）
 *     → 标记为 "static"，并记录 value 节点的源码位置（valueStart/valueEnd）
 *   - value 是其他任何表达式（Identifier、MemberExpression、CallExpression 等）
 *     → 标记为 "dynamic"
 * - 最终把结果以 JSON 字符串写入 `data-style-info`
 *
 * data-style-info 的值格式：
 * {
 *   [cssKey]: {
 *     kind: 'static' | 'dynamic',
 *     // 仅 static 时存在，指向源码中该 value 节点的字符偏移，便于直接替换
 *     valueStart?: number,
 *     valueEnd?: number,
 *   }
 * }
 *
 * 示例：
 *   输入：  <div style={{ color: 'red', width: item.width }} />
 *   输出：  <div
 *             style={{ color: 'red', width: item.width }}
 *             data-style-info='{"color":{"kind":"static","valueStart":20,"valueEnd":25},"width":{"kind":"dynamic"}}'
 *           />
 */

/** 判断 AST value 节点是否为静态字面量 */
function isStaticValue(valueNode: any): boolean {
  if (!valueNode) return false;
  const { type } = valueNode;
  return (
    type === 'StringLiteral' ||
    type === 'NumericLiteral' ||
    type === 'BooleanLiteral' ||
    type === 'NullLiteral' ||
    // 模板字面量（无插值）也视为静态
    (type === 'TemplateLiteral' && valueNode.expressions?.length === 0)
  );
}

export interface StyleKeyInfo {
  kind: 'static' | 'dynamic';
  /** 仅 static 时存在：value 节点在源码中的起始字符偏移（含引号） */
  valueStart?: number;
  /** 仅 static 时存在：value 节点在源码中的结束字符偏移（不含） */
  valueEnd?: number;
}

export type StyleInfo = Record<string, StyleKeyInfo>;

/**
 * 从 style 属性的 JSXExpressionContainer 中解析出 ObjectExpression，
 * 返回 { [cssKey]: StyleKeyInfo } 的映射，若无法解析则返回 null。
 */
function extractStyleInfo(styleAttr: any): StyleInfo | null {
  // style={...}
  if (!styleAttr?.value) return null;

  let objectExpr: any = null;

  if (styleAttr.value.type === 'JSXExpressionContainer') {
    const expr = styleAttr.value.expression;
    if (expr?.type === 'ObjectExpression') {
      objectExpr = expr;
    }
  }

  if (!objectExpr) return null;

  const result: StyleInfo = {};

  for (const prop of objectExpr.properties) {
    // 跳过展开运算符：...rest
    if (prop.type === 'SpreadElement' || prop.type === 'RestElement') continue;

    // 获取 key 名称（支持 Identifier key 和 StringLiteral key）
    let keyName: string | null = null;
    if (prop.key?.type === 'Identifier') {
      keyName = prop.key.name;
    } else if (prop.key?.type === 'StringLiteral') {
      keyName = prop.key.value;
    }

    if (!keyName) continue;

    const isStatic = isStaticValue(prop.value);

    if (isStatic) {
      result[keyName] = {
        kind: 'static',
        valueStart: prop.value.start,
        valueEnd: prop.value.end,
      };
    } else {
      result[keyName] = { kind: 'dynamic' };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

export default function styleAnalysisPlugin() {
  return function ({ types: t }: { types: any }) {
    return {
      visitor: {
        JSXOpeningElement(path: any) {
          try {
            const { node } = path;
            const attributes: any[] = node.attributes;

            // 找到 style 属性
            const styleAttr = attributes.find(
              (attr: any) => attr.type === 'JSXAttribute' && attr.name?.name === 'style'
            );

            if (!styleAttr) return;

            const styleInfo = extractStyleInfo(styleAttr);
            if (!styleInfo) return;

            // 幂等保护：已经注入过则跳过
            const alreadyInjected = attributes.some(
              (attr: any) => attr.type === 'JSXAttribute' && attr.name?.name === 'data-style-info'
            );
            if (alreadyInjected) return;

            // 将结果序列化为 JSON 字符串，写入 data-style-info 属性
            const infoJson = JSON.stringify(styleInfo);

            attributes.push(
              t.jsxAttribute(
                t.jsxIdentifier('data-style-info'),
                t.stringLiteral(infoJson)
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
