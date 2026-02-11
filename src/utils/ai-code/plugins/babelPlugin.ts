import * as types from "./types";
import { getMapCallbackIndexParam } from "./utils";

export default function ({ constituency }) {
  return function () {
    const importRelyMap = new Map();

    return {
      visitor: {
        ImportDeclaration(path) {
          try {
            const { node } = path;
            node.specifiers.forEach((specifier) => {
              if (types.isImportSpecifier(specifier)) {
                importRelyMap.set(specifier.local.name, node.source.value);
              }
            })
          } catch { }
        },
        VariableDeclarator(path) {
          try {
            const { id, init } = path.node;
            if (types.isIdentifier(id) && types.isMemberExpression(init)) {
              const name = path.node.id?.name;
              const relyName = path.node.init?.object?.loc?.identifierName;
              importRelyMap.set(name, relyName);
            }
          } catch { }
        },
        JSXElement(path) {
          try {
            const { node } = path;
            const dataLocValueObject: any = {
              jsx: { start: node.start, end: node.end },
              tag: { end: node.openingElement.end },
            }
            const classNameAttr = node.openingElement.attributes.find((a) => a.name?.name === "className");
            const classNameExpr = classNameAttr?.value?.type === "JSXExpressionContainer" ? classNameAttr.value.expression : null;
            const cnList = [...new Set(extractCssClassNames(classNameExpr))];

            if (cnList.length > 0) {
              dataLocValueObject.cn = cnList
              const { relyName, source } = findRelyAndSource(node.openingElement.name.name, importRelyMap);

              constituency.push({
                className: cnList,
                component: relyName,
                source,
              })

              // node.openingElement.attributes.push({
              //   type: 'JSXAttribute',
              //   name: {
              //     type: 'JSXIdentifier',
              //     name: 'data-cn',
              //   },
              //   value: {
              //     type: 'StringLiteral',
              //     value: cnList.join(' '),
              //     extra: {
              //       raw: `"${cnList.join(' ')}"`,
              //       rawValue: cnList.join(' ')
              //     }
              //   }
              // })

              const mapIndexParam = getMapCallbackIndexParam(path);
              if (mapIndexParam != null) {
                node.openingElement.attributes.push({
                  type: 'JSXAttribute',
                  name: { type: 'JSXIdentifier', name: 'data-map-index' },
                  value: {
                    type: 'JSXExpressionContainer',
                    expression: { type: 'Identifier', name: mapIndexParam },
                  },
                });
              }
            }

            const dataLocValue = JSON.stringify(dataLocValueObject)

            node.openingElement.attributes.push({
              type: 'JSXAttribute',
              name: {
                type: 'JSXIdentifier',
                name: 'data-loc',
              },
              value: {
                type: 'StringLiteral',
                value: dataLocValue,
                extra: {
                  raw: `"${dataLocValue}"`,
                  rawValue: dataLocValue
                }
              }
            })
          } catch { }
        },
        Program: {
          exit() {
            // 解析/遍历结束：整棵 AST 已访问完，importRecord 等已收集完毕
            // console.log("[@importRelyMap]", { importRelyMap })
          }
        }
      }
    };
  }
}

/**
 * 从 className 表达式中提取所有 css.xxx 的 xxx 值
 * 支持：css.button、`${css.button} ${css.submit}`、条件表达式中的 css.disabled 等
 */
function extractCssClassNames(node: any): string[] {
  const result: string[] = [];
  if (!node) return result;

  if (node.type === "MemberExpression") {
    const obj = node.object;
    const prop = node.property;
    if (obj?.type === "Identifier" && obj.name === "css" && prop?.type === "Identifier") {
      result.push(prop.name);
    }
    return result;
  }

  if (node.type === "TemplateLiteral") {
    for (const expr of node.expressions || []) {
      result.push(...extractCssClassNames(expr));
    }
    return result;
  }

  if (node.type === "ConditionalExpression") {
    result.push(...extractCssClassNames(node.consequent));
    result.push(...extractCssClassNames(node.alternate));
    return result;
  }

  if (node.type === "LogicalExpression") {
    result.push(...extractCssClassNames(node.left));
    result.push(...extractCssClassNames(node.right));
    return result;
  }

  return result;
}

function findRelyAndSource(relyName, importRelyMap) {
  const value = importRelyMap.get(relyName);
  if (value == null) {
    return { relyName, source: "html" };
  }
  // value 可能是 source（直接 import），也可能是另一个 relyName（解构自 Typography.Text）
  const nextValue = importRelyMap.get(value);
  if (nextValue !== undefined) {
    // value 仍是 relyName，继续递归，最终返回链末的 { relyName, source }
    return findRelyAndSource(value, importRelyMap);
  }
  // value 是 source，relyName 即为最后一个从 source 解构出来的 relyName
  // 除了三方库，就是html
  return { relyName, source: value || "html" };
}
