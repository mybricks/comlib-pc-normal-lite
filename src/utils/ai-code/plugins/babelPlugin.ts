import * as types from "./types";
import { 
  getMapCallbackIndexParam,
  pushDataAttr,
  pushDataAttrExpression,
  getCssSelectorForJSXPath,
  extractCssClassNames,
  findRelyAndSource,
  getComRefForJSXPath
} from "./utils";

export default function ({ constituency }) {
  return function () {
    const importRelyMap = new Map();
    /** 按组件声明缓存 { rootJSX, jsdoc }，每个 comRef 组件只计算一次 */
    const componentJsdocCache = new Map<any, any>();

    return {
      visitor: {
        ImportDeclaration(path) {
          try {
            const { node } = path;
            node.specifiers.forEach((specifier) => {
              if (types.isImportSpecifier(specifier) || types.isImportDefaultSpecifier(specifier)) {
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
            };
            const classNameAttr = node.openingElement.attributes.find((a) => a.name?.name === "className");
            const classNameExpr = classNameAttr?.value?.type === "JSXExpressionContainer" ? classNameAttr.value.expression : null;
            const cnList = [...new Set(extractCssClassNames(classNameExpr))];

            const selectors = getCssSelectorForJSXPath(path, importRelyMap);
            const lastSelector = selectors.length > 0 ? selectors.reverse()[0].split(' ').reverse()[0] : node.openingElement.name.name;
            pushDataAttr(node.openingElement.attributes, "data-zone-title", lastSelector);

            const { relyName, source } = findRelyAndSource(node.openingElement.name.name, importRelyMap);

            if (source === "html") {
              pushDataAttr(node.openingElement.attributes, "data-zone-selector", JSON.stringify(selectors));
            } else {
              pushDataAttr(node.openingElement.attributes, "data-library-source", source);
            }

            if (cnList.length > 0) {
              dataLocValueObject.cn = cnList
              

              // 仅当当前 JSX 是「组件根节点」时挂 JSDoc（summary、@prop），并写入 data-loc，供聚焦时读取；按组件缓存避免重复计算
              // const jsdoc = getComRefForJSXPath(path, componentJsdocCache);
              // if (jsdoc) {
              //   dataLocValueObject.jsdoc = jsdoc;
              // }

              constituency.push({
                className: cnList,
                component: relyName,
                source,
                selectors,
                // ...(jsdoc && { jsdoc }),
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
                pushDataAttrExpression(node.openingElement.attributes, "data-map-index", mapIndexParam);
              }
            }

            let zoneType = "zone";

            const comRef = getComRefForJSXPath(path, componentJsdocCache);
            if (comRef) {
              zoneType = "com";
              pushDataAttr(node.openingElement.attributes, "data-zone-docs", JSON.stringify(comRef.jsdoc));
              pushDataAttr(node.openingElement.attributes, "data-com-name", comRef.name);

              const events = comRef.jsdoc?.events;
              if (events) {
                pushDataAttr(node.openingElement.attributes, "data-zone-docs-events", JSON.stringify(events.length));
              }
            }

            pushDataAttr(node.openingElement.attributes, "data-zone-type", zoneType);
            pushDataAttr(node.openingElement.attributes, "data-loc", JSON.stringify(dataLocValueObject));
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
