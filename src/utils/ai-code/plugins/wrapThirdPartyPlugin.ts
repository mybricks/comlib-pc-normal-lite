/**
 * Babel 插件：识别所有三方依赖组件，在其外层包裹一个透明 div 容器。
 *
 * 处理规则：
 * - 三方组件：通过非相对路径（不以 `.` 开头）导入的大写字母开头的组件
 * - 包裹容器：`<div style={{ display: 'contents' }}>`，透明容器不影响布局
 * - data 属性：与三方组件上挂载的 data-* 属性完全一致（同步镜像）
 *
 * 示例：
 *   import { Button } from 'antd';
 *   // 输入：
 *   <Button type="primary" data-loc="...">click</Button>
 *   // 输出：
 *   <div style={{ display: 'contents' }} data-loc="...">
 *     <Button type="primary" data-loc="...">click</Button>
 *   </div>
 */

/** 判断 import source 是否为三方库（非相对路径） */
function isThirdPartyImport(source: string): boolean {
  return !source.startsWith('.') && !source.startsWith('/') && source !== 'mybricks';
}

export default function wrapThirdPartyPlugin() {
  return function ({ types: t }: { types: any }) {
    /** 收集三方库导入的组件名（本地变量名集合） */
    const thirdPartyComponents = new Set<string>();

    return {
      visitor: {
        ImportDeclaration(path: any) {
          try {
            const { node } = path;
            const source: string = node.source.value;

            // 只处理三方库（非相对路径）
            if (!isThirdPartyImport(source)) return;

            node.specifiers.forEach((specifier: any) => {
              if (
                specifier.type === 'ImportSpecifier' ||
                specifier.type === 'ImportDefaultSpecifier' ||
                specifier.type === 'ImportNamespaceSpecifier'
              ) {
                thirdPartyComponents.add(specifier.local.name);
              }
            });
          } catch {
            // 静默处理
          }
        },

        JSXElement: {
          enter(path: any) {
            try {
              const { node } = path;
              const openingElement = node.openingElement;
              const nameNode = openingElement.name;

              // 获取 JSX 标签的根对象名
              let tagName: string | null = null;
              if (nameNode.type === 'JSXIdentifier') {
                tagName = nameNode.name;
              } else if (nameNode.type === 'JSXMemberExpression') {
                // 如 <Modal.Footer>，取根对象名 "Modal"
                let cur = nameNode;
                while (cur.type === 'JSXMemberExpression') {
                  cur = cur.object;
                }
                if (cur.type === 'JSXIdentifier') {
                  tagName = cur.name;
                }
              }

              if (!tagName) return;

              // 只处理大写字母开头的三方库组件（排除 html 原生标签）
              if (!/^[A-Z]/.test(tagName)) return;
              if (!thirdPartyComponents.has(tagName)) return;

              // 防止重复包裹：如果父节点已经是我们生成的透明 div 包裹层，则跳过
              const parentPath = path.parentPath;
              if (parentPath?.isJSXElement?.()) {
                const parentOpeningEl = parentPath.node.openingElement;
                if (_isWrapperDiv(parentOpeningEl)) return;
              }

              // 收集三方组件上所有的 data-* 属性，复制到外层 div
              const dataAttrs: any[] = openingElement.attributes.filter((attr: any) => {
                if (attr.type !== 'JSXAttribute') return false;
                const attrName: string =
                  typeof attr.name?.name === 'string' ? attr.name.name : '';
                return attrName.startsWith('data-');
              });

              // 构建 style={{ display: 'contents' }} 属性
              const styleAttr = t.jsxAttribute(
                t.jsxIdentifier('style'),
                t.jsxExpressionContainer(
                  t.objectExpression([
                    t.objectProperty(
                      t.identifier('display'),
                      t.stringLiteral('contents')
                    ),
                  ])
                )
              );

              // 深拷贝 data-* 属性到 div，避免引用共享
              const clonedDataAttrs = dataAttrs.map((attr: any) => _cloneJSXAttr(t, attr));

              // 构建包裹 div
              const wrapperOpeningEl = t.jsxOpeningElement(
                t.jsxIdentifier('div'),
                [styleAttr, ...clonedDataAttrs],
                false
              );
              const wrapperClosingEl = t.jsxClosingElement(t.jsxIdentifier('div'));
              const wrapperElement = t.jsxElement(
                wrapperOpeningEl,
                wrapperClosingEl,
                [node],
                false
              );

              // 标记为已生成的包裹层，防止重复处理
              (wrapperOpeningEl as any).__isThirdPartyWrapper = true;

              path.replaceWith(wrapperElement);
              // 替换后，babel 会重新访问新节点，需要跳过子路径以避免死循环
              path.skip();
            } catch {
              // 静默处理
            }
          },
        },
      },
    };
  };
}

/**
 * 判断一个 JSXOpeningElement 是否是我们生成的透明 div 包裹层
 */
function _isWrapperDiv(openingEl: any): boolean {
  if (!openingEl) return false;
  if (openingEl.__isThirdPartyWrapper) return true;
  // 二次检测：div + 含 style={{ display: 'contents' }} 属性
  const name = openingEl.name?.name;
  if (name !== 'div') return false;
  return openingEl.attributes?.some((attr: any) => {
    if (attr.type !== 'JSXAttribute' || attr.name?.name !== 'style') return false;
    const expr = attr.value?.expression;
    if (!expr || expr.type !== 'ObjectExpression') return false;
    return expr.properties?.some((prop: any) => {
      return (
        prop.key?.name === 'display' &&
        prop.value?.value === 'contents'
      );
    });
  }) ?? false;
}

/**
 * 深拷贝一个 JSXAttribute 节点，避免引用共享（同一 AST 节点不能出现在两处）
 */
function _cloneJSXAttr(t: any, attr: any): any {
  try {
    const nameName: string = attr.name?.name ?? '';
    const attrName = t.jsxIdentifier(nameName);

    if (!attr.value) {
      return t.jsxAttribute(attrName, null);
    }

    // StringLiteral
    if (attr.value.type === 'StringLiteral') {
      return t.jsxAttribute(attrName, t.stringLiteral(attr.value.value));
    }

    // JSXExpressionContainer
    if (attr.value.type === 'JSXExpressionContainer') {
      // 对表达式做浅拷贝：直接复用同一 expression 节点
      // （data-* 属性通常是字符串字面量，表达式形式极少出现）
      return t.jsxAttribute(attrName, t.jsxExpressionContainer(attr.value.expression));
    }

    // fallback：尝试直接复用 value
    return t.jsxAttribute(attrName, attr.value);
  } catch {
    return attr;
  }
}
