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
  getPopupRefForJSXPath,
  parseJSXComments,
  getJSXElementNameString,
  hasEditableTextContent,
  isComRefCall,
  isPopupRefCall,
  extractRefFromVariableDeclarator,
  extractRefFromExportDefault,
} from "./utils";

/** 从文件路径派生组件名：folder/index.jsx → folder 名；直接文件 → 文件名（去扩展名） */
function deriveNameFromFilePath(filePath?: string): string {
  if (!filePath) return 'root';
  const parts = filePath.replace(/\\/g, '/').split('/');
  const last = parts[parts.length - 1];
  const stem = last.replace(/\.[^.]+$/, ''); // 去掉扩展名
  if (stem === 'index' && parts.length > 1) {
    return parts[parts.length - 2]; // 用父级文件夹名
  }
  return stem || 'root';
}

export default function ({ constituency, fileName }: { constituency: any; fileName?: string }) {
  const fallbackName = deriveNameFromFilePath(fileName);
  return function () {
    const importRelyMap = new Map();
    /** 按组件声明缓存 { rootJSX, jsdoc }，每个 comRef 组件只计算一次 */
    const componentJsdocCache = new Map<any, any>();
    /** 按组件声明缓存 pageRef 的 { rootJSX, jsdoc, name }，每个 pageRef 只计算一次 */
    const pageRefCache = new Map<any, any>();
    /** 按组件声明缓存 popupRef 的 { rootJSX, jsdoc, name }，每个 popupRef 只计算一次 */
    const popupRefCache = new Map<any, any>();

    /** 遍历时 comRef 的 jsdoc 栈，子元素通过栈顶读到当前组件的 jsdoc */
    // const jsdocStack: any[] = [];

    const popupRefDeclarators = new Map();

    // [TODO] 未来可能从多文件导入less
    const lessMap = new Map();
    /** CSS Module 导入的本地变量名集合，如 import styles from './index.less' 则记录 'styles' */
    const cssModuleNames = new Set<string>();

    return {
      visitor: {
        ImportDeclaration(path) {
          try {
            const { node } = path;     
            node.specifiers.forEach((specifier) => {
              if (types.isImportSpecifier(specifier) || types.isImportDefaultSpecifier(specifier)) {
                importRelyMap.set(specifier.local.name, node.source.value);

                if (node.source.value.endsWith('.less')) {
                  cssModuleNames.add(specifier.local.name);
                }
                if (node.source.value.endsWith('.less') && fileName) {
                  let currentPath = fileName.split('/');
                  currentPath = currentPath.slice(0, currentPath.length - 1)
                  const targetPath = node.source.value.split('/');
                  targetPath.forEach((path) => {
                    if (path === ".") {
                    } else if (path === "..") {
                      currentPath.pop();
                    } else {
                      currentPath.push(path)
                    }
                  })
                  const lessFilePath = currentPath.join('/');
                  lessMap.set("less", lessFilePath);
                }
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
            if (
              types.isIdentifier(id) &&
              types.isCallExpression(init) &&
              types.isIdentifier(init.callee) &&
              init.callee.name === 'popupRef'
            ) {
              const componentName = id.name;
              popupRefDeclarators.set(path.node, componentName);
            }
            // 为 comRef / popupRef 注入第二个参数 { widgetName }
            if (
              types.isIdentifier(id) &&
              types.isCallExpression(init) &&
              (isComRefCall(init.callee) || isPopupRefCall(init.callee)) &&
              init.arguments.length === 1
            ) {
              const widgetName = (id as any).name as string;
              init.arguments.push({
                type: 'ObjectExpression',
                properties: [
                  {
                    type: 'ObjectProperty',
                    key: { type: 'Identifier', name: 'widgetName' },
                    value: { type: 'StringLiteral', value: widgetName },
                    shorthand: false,
                    computed: false,
                  } as any,
                ],
              } as any);
            }
          } catch { }
        },
        ExportDefaultDeclaration(path) {
          try {
            const { declaration } = path.node as any;
            if (
              declaration &&
              declaration.type === 'CallExpression' &&
              (isComRefCall(declaration.callee) || isPopupRefCall(declaration.callee)) &&
              declaration.arguments.length === 1
            ) {
              declaration.arguments.push({
                type: 'ObjectExpression',
                properties: [
                  {
                    type: 'ObjectProperty',
                    key: { type: 'Identifier', name: 'widgetName' },
                    value: { type: 'StringLiteral', value: fallbackName },
                    shorthand: false,
                    computed: false,
                  } as any,
                ],
              } as any);
            }
          } catch { }
        },
        JSXElement: {
          enter(path) {
            try {
              const { node } = path;

              const dataZoneTextEditable = hasEditableTextContent(node)

              if (dataZoneTextEditable) {
                pushDataAttr(node.openingElement.attributes, "data-zone-text-editable", JSON.stringify(dataZoneTextEditable));
              }
              const dataLocValueObject: any = {
                jsx: { start: node.start, end: node.end },
                tag: { end: node.openingElement.end },
                codeLine: {
                  start: node.loc.start.line,
                  end: node.loc.end.line
                },
                files: {
                  jsx: fileName,
                  less: lessMap.get("less")
                }
              };
              const classNameAttr = node.openingElement.attributes.find((a) => a.name?.name === "className");
              const classNameExpr = classNameAttr?.value?.type === "JSXExpressionContainer" ? classNameAttr.value.expression : null;
              // extractCssClassNames 现在返回 CssClassName[]，这里提取 .name 并去重
              // 保持 cnList 为 string[]，data-loc 和 constituency.className 的下游消费者无需改动
              const cnList = [...new Set(extractCssClassNames(classNameExpr, false, cssModuleNames).map(c => c.name))];
  
              const selectors = getCssSelectorForJSXPath(path, importRelyMap, cssModuleNames);
              const tagName = getJSXElementNameString(node.openingElement.name)?.split(".")[0];
              if (!tagName) {
                return;
              }
              const lastSelector = selectors.length > 0 ? selectors.reverse()[0].split(' ').reverse()[0] : tagName;

              const pageRef = getPageRefForJSXPath(path, pageRefCache, fallbackName);
              if (pageRef) {
                const pageTitle = pageRef.jsdoc?.summary ?? pageRef.name ?? lastSelector;
                pushDataAttr(node.openingElement.attributes, "data-zone-title", pageTitle);
                // pushDataAttr(node.openingElement.attributes, "title", pageTitle);
                pushDataAttr(node.openingElement.attributes, "data-widget-name", pageRef.name);
              } else {
                pushDataAttr(node.openingElement.attributes, "data-zone-title", lastSelector);
              }

              const popupRef = getPopupRefForJSXPath(path, popupRefCache, fallbackName);
              if (popupRef) {
                const dialogTitle = popupRef.jsdoc?.summary ?? popupRef.name ?? lastSelector;
                pushDataAttr(node.openingElement.attributes, "data-zone-title", dialogTitle);
                pushDataAttr(node.openingElement.attributes, "data-widget-name", popupRef.name);
              }

              const { relyName, source } = findRelyAndSource(tagName, importRelyMap);
  
              if (source === "html") {
                if (cnList.length > 0) {
                  pushDataAttr(node.openingElement.attributes, "data-zone-selector", JSON.stringify(selectors));
                } else {
                  pushDataAttr(node.openingElement.attributes, "data-zone-noselector", "true");
                }
              } else {
                pushDataAttr(node.openingElement.attributes, "data-library-source", source);
                // 提取静态 JSX props，供 dom-to-figma 的变体库匹配使用。
                // 格式：{ component: "Button", props: { type: "primary", size: "large" } }
                // component 字段在消费侧用于确定性地筛选同类组件候选，避免跨组件类型误匹配。
                if (tagName && /^[A-Z]/.test(tagName)) {
                  const figmaPropsPayload = extractFigmaProps(node, tagName);
                  pushDataAttr(node.openingElement.attributes, "data-figma-props", JSON.stringify(figmaPropsPayload));
                }
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

              const comRef = getComRefForJSXPath(path, componentJsdocCache, fallbackName);
              if (pageRef) {
                zoneType = "page";
              }

              if (comRef) {
                // jsdocStack.push(comRef.jsdoc);

                zoneType = "com";
                // pushDataAttr(node.openingElement.attributes, "data-zone-docs", JSON.stringify(comRef.jsdoc));
                pushDataAttr(node.openingElement.attributes, "data-com-name", comRef.name);

                pushDataAttr(node.openingElement.attributes, "data-widget-name", comRef.name);

  
                // const events = comRef.jsdoc?.events;
                // if (events) {
                //   pushDataAttr(node.openingElement.attributes, "data-zone-docs-events", JSON.stringify(events.length));
                // }
              }

              const { events, datasource, store } = parseJSXComments(node)
        

              // const events = getEvents(node);

              // const jsdoc = jsdocStack[jsdocStack.length - 1];);

              // const eventsMap = (jsdoc?.events || []).reduce((pre, cur) => {
              //   pre[cur.key] = cur;
              //   return pre;
              // }, {});

              // const dataZoneDocsEvents = events.map((event) => {
              //   return eventsMap[event] || {
              //     key: event,
              //     name: event,
              //     description: ""
              //   }
              // })

              if (events.length > 0) {
                pushDataAttr(node.openingElement.attributes, "data-zone-events", JSON.stringify(events));
                // 用于展示事件小黄点
                pushDataAttr(node.openingElement.attributes, "data-zone-docs-events", JSON.stringify(events.length));
              }

              if (datasource) {
                pushDataAttr(node.openingElement.attributes, "data-zone-datasource", datasource);
              }

              if (store) {
                pushDataAttr(node.openingElement.attributes, "data-zone-store", store);
              }

              // if (comRef) {
              //   pushDataAttr(node.openingElement.attributes, "data-zone-docs", JSON.stringify({...comRef.jsdoc, events: dataZoneDocsEvents}));
              // } else {
              //   pushDataAttr(node.openingElement.attributes, "data-zone-docs", JSON.stringify({events: dataZoneDocsEvents}));
              // }
  
              if (zoneType !== "page") {
                pushDataAttr(node.openingElement.attributes, "data-zone-type", zoneType);
              }
              pushDataAttr(node.openingElement.attributes, "data-loc", JSON.stringify(dataLocValueObject));

              let foundDeclaratorPath: any = null;
              path.findParent(p => {
                if (p.isJSXElement()) {
                  return true; // 遇到父级 JSX 即停，说明当前节点不是顶层
                }
                if (p.isVariableDeclarator() && popupRefDeclarators.has(p.node)) {
                  foundDeclaratorPath = p;
                  return true;
                }
                return false;
              });
              const popupName = foundDeclaratorPath
                ? popupRefDeclarators.get(foundDeclaratorPath.node)
                : null;

              if (popupName) {
                pushDataAttr(node.openingElement.attributes, "data-widge-name", popupName);
              }
            } catch {}
          },
          exit(path) {
            // try {
            //   const comRef = getComRefForJSXPath(path, componentJsdocCache);
            //   if (comRef) {
            //     jsdocStack.pop();
            //   }
            // } catch {}
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

/**
 * 从 JSX 节点的 AST 中提取静态 props，供 Figma 变体库匹配。
 * 只提取静态字面量（StringLiteral / BooleanLiteral），动态表达式跳过。
 *
 * 返回结构：
 *   { component: "Button", props: { type: "primary", size: "large", hasIcon: true } }
 *
 * component 字段为 JSX 组件名，消费侧用于确定性地筛选同类组件候选，
 * 与 props（JSX props 快照）职责分离，避免命名冲突。
 */
function extractFigmaProps(node: any, tagName: string): { component: string; props: Record<string, any> } {
    // prefix/suffix 存实际字符串值，消费侧（component-library-resolver）用 !! 判断是否有前/后缀；
    // showCount 存布尔值，供 Input 字数计数变体匹配。
    const SCALAR_PROPS = ['type', 'size', 'danger', 'ghost', 'loading', 'disabled', 'shape', 'prefix', 'suffix', 'showCount'];
  const props: Record<string, any> = {};

  try {
    const attrs = node.openingElement?.attributes;
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        if (attr.type !== 'JSXAttribute' || !attr.name) continue;
        const propName: string = typeof attr.name.name === 'string' ? attr.name.name : '';
        if (!propName) continue;

        if (propName === 'icon') {
          props.hasIcon = true;
          continue;
        }

        if (!SCALAR_PROPS.includes(propName)) continue;

        if (!attr.value) {
          // <Button disabled> 形式——布尔属性无值，等价于 true
          props[propName] = true;
          continue;
        }

        if (attr.value.type === 'StringLiteral') {
          props[propName] = attr.value.value;
        } else if (attr.value.type === 'JSXExpressionContainer') {
          const expr = attr.value.expression;
          if (expr && expr.type === 'BooleanLiteral') {
            props[propName] = expr.value;
          }
          // 动态表达式（标识符、三元等）无法静态求值，跳过
        }
      }
    }
  } catch { /* ignore */ }

  return { component: tagName, props };
}
