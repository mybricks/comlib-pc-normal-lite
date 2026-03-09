import * as types from "./types";
import { 
  getMapCallbackIndexParam,
  pushDataAttr,
  pushDataAttrExpression,
  getCssSelectorForJSXPath,
  extractCssClassNames,
  findRelyAndSource,
  getComRefForJSXPath,
  getPageRefForJSXPath,
  getEvents,
  getJSXElementNameString
} from "./utils";

export default function ({ constituency }) {
  return function () {
    const importRelyMap = new Map();
    /** 按组件声明缓存 { rootJSX, jsdoc }，每个 comRef 组件只计算一次 */
    const componentJsdocCache = new Map<any, any>();
    /** 按组件声明缓存 pageRef 的 { rootJSX, jsdoc, name }，每个 pageRef 只计算一次 */
    const pageRefCache = new Map<any, any>();

    /** 遍历时 comRef 的 jsdoc 栈，子元素通过栈顶读到当前组件的 jsdoc */
    const jsdocStack: any[] = [];

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
        JSXElement: {
          enter(path) {
            try {
              const { node } = path;
              const dataLocValueObject: any = {
                jsx: { start: node.start, end: node.end },
                tag: { end: node.openingElement.end },
              };
              const classNameAttr = node.openingElement.attributes.find((a) => a.name?.name === "className");
              const classNameExpr = classNameAttr?.value?.type === "JSXExpressionContainer" ? classNameAttr.value.expression : null;
              // extractCssClassNames 现在返回 CssClassName[]，这里提取 .name 并去重
              // 保持 cnList 为 string[]，data-loc 和 constituency.className 的下游消费者无需改动
              const cnList = [...new Set(extractCssClassNames(classNameExpr).map(c => c.name))];
  
              const selectors = getCssSelectorForJSXPath(path, importRelyMap);
              const tagName = getJSXElementNameString(node.openingElement.name)?.split(".")[0];
              if (!tagName) {
                return;
              }
              const lastSelector = selectors.length > 0 ? selectors.reverse()[0].split(' ').reverse()[0] : tagName;

              const pageRef = getPageRefForJSXPath(path, pageRefCache);
              if (pageRef) {
                const pageTitle = pageRef.jsdoc?.summary ?? pageRef.name ?? lastSelector;
                pushDataAttr(node.openingElement.attributes, "data-zone-title", pageTitle);
                pushDataAttr(node.openingElement.attributes, "title", pageTitle);
              } else {
                pushDataAttr(node.openingElement.attributes, "data-zone-title", lastSelector);
              }

              const { relyName, source } = findRelyAndSource(tagName, importRelyMap);
  
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
              if (pageRef) {
                zoneType = "page";
              }

              if (comRef) {
                jsdocStack.push(comRef.jsdoc);

                zoneType = "com";
                // pushDataAttr(node.openingElement.attributes, "data-zone-docs", JSON.stringify(comRef.jsdoc));
                pushDataAttr(node.openingElement.attributes, "data-com-name", comRef.name);


  
                // const events = comRef.jsdoc?.events;
                // if (events) {
                //   pushDataAttr(node.openingElement.attributes, "data-zone-docs-events", JSON.stringify(events.length));
                // }
              }

              const events = getEvents(node);
              const jsdoc = jsdocStack[jsdocStack.length - 1];

              const eventsMap = (jsdoc?.events || []).reduce((pre, cur) => {
                pre[cur.key] = cur;
                return pre;
              }, {});

              const dataZoneDocsEvents = events.map((event) => {
                return eventsMap[event] || {
                  key: event,
                  name: event,
                  description: ""
                }
              })

              if (dataZoneDocsEvents.length > 0) {
                pushDataAttr(node.openingElement.attributes, "data-zone-docs-events", JSON.stringify(dataZoneDocsEvents.length));
              }

              if (comRef) {
                pushDataAttr(node.openingElement.attributes, "data-zone-docs", JSON.stringify({...comRef.jsdoc, events: dataZoneDocsEvents}));
              } else {
                pushDataAttr(node.openingElement.attributes, "data-zone-docs", JSON.stringify({events: dataZoneDocsEvents}));
              }
  
              pushDataAttr(node.openingElement.attributes, "data-zone-type", zoneType);
              pushDataAttr(node.openingElement.attributes, "data-loc", JSON.stringify(dataLocValueObject));
            } catch {}
          },
          exit(path) {
            try {
              const comRef = getComRefForJSXPath(path, componentJsdocCache);
              if (comRef) {
                jsdocStack.pop();
              }
            } catch {}
          }
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
