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
import { isInsideMapCallback } from './wrapCustomComponentPlugin'

/**
 * 从 JSXElement 的 path 向上找到最近的 `.map()` CallExpression，
 * 返回该 CallExpression 的代码行范围；找不到则返回 null。
 *
 * 注意：此处操作的是 JSX AST（babelPlugin 在 JSX transform 之前运行），
 * 因此向上找的是原始 ArrowFunctionExpression / FunctionExpression 节点的父级。
 */
function getMapCallLoc(path: any): { start: number; end: number } | null {
  let cur = path.parentPath;
  while (cur) {
    const { node } = cur;
    if (
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'FunctionExpression'
    ) {
      const parentCall = cur.parentPath?.node;
      if (
        parentCall?.type === 'CallExpression' &&
        parentCall.callee?.type === 'MemberExpression' &&
        parentCall.callee.property?.name === 'map' &&
        parentCall.loc
      ) {
        return {
          start: parentCall.loc.start.line,
          end: parentCall.loc.end.line,
        };
      }
      return null;
    }
    if (node.type === 'JSXElement') {
      return null; // 中间隔了父级 JSX，不是 map 直接子节点
    }
    cur = cur.parentPath;
  }
  return null;
}

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
              pushDataAttr(node.openingElement.attributes, "data-zone-classnames", cnList.join(','));
              const selectors = getCssSelectorForJSXPath(path, importRelyMap, cssModuleNames);
              // fullComponentName 保留完整 JSX 组件名（如 "Input.Search"），用于 data-figma-props 变体库匹配
              const fullComponentName = getJSXElementNameString(node.openingElement.name);
              // tagName 取根对象名（如 "Input"），用于 findRelyAndSource / selector 等后续逻辑
              const tagName = fullComponentName?.split(".")[0];
              if (!tagName) {
                return;
              }

              if (tagName === 'svg') {
                pushDataAttr(node.openingElement.attributes, 'data-zone-svg', 'true');
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

              // [观察下三方库的样式编辑问题]
              if (cnList.length > 0) {
                pushDataAttr(node.openingElement.attributes, "data-zone-selector", JSON.stringify(selectors));
              } else {
                pushDataAttr(node.openingElement.attributes, "data-zone-noselector", "true");
              }
  
              if (source === "html") {
                // if (cnList.length > 0) {
                //   pushDataAttr(node.openingElement.attributes, "data-zone-selector", JSON.stringify(selectors));
                // } else {
                //   pushDataAttr(node.openingElement.attributes, "data-zone-noselector", "true");
                // }
              } else {
                pushDataAttr(node.openingElement.attributes, "data-library-source", source);
                // 提取静态 JSX props，供 dom-to-figma 的变体库匹配使用。
                // 格式：{ component: "Button", props: { type: "primary", size: "large" } }
                // component 字段在消费侧用于确定性地筛选同类组件候选，避免跨组件类型误匹配。
                if (tagName && /^[A-Z]/.test(tagName)) {
                  // 使用完整组件名（如 "Input.Search"）而非基础名（"Input"），确保变体库匹配时能区分子组件
                  const figmaPropsPayload = extractFigmaProps(node, fullComponentName || tagName);
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
              
              if (isInsideMapCallback(path)) {
                pushDataAttr(node.openingElement.attributes, "data-zone-isMap", "true");
                const mapCallLoc = getMapCallLoc(path);
                if (mapCallLoc) {
                  dataLocValueObject.mapCall = mapCallLoc;
                }
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
    // prefix/suffix 存实际字符串值（或 true 表示有动态内容），消费侧用 !! 判断是否有内嵌前/后缀；
    // addonBefore/addonAfter 存字符串值，供 Input 外置前/后置区域变体匹配；
    // showCount 存布尔值，供 Input 字数计数变体匹配；
    // enterButton 存字符串值（如 "搜索"）或 true，供 Input.Search 文字按钮维度匹配。
    const SCALAR_PROPS = [
      'type', 'size', 'color', 'danger', 'ghost', 'loading', 'disabled', 'shape',
      'prefix', 'suffix', 'showCount', 'addonBefore', 'addonAfter', 'enterButton',
      'message', 'description', 'title',
      'showIcon', 'closable', 'banner', 'bordered', 'readonly', 'allowClear',
      'checked', 'defaultChecked', 'open', 'defaultOpen', 'block',
    ];
  const props: Record<string, any> = {};

  try {
    const attrs = node.openingElement?.attributes;
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        if (attr.type !== 'JSXAttribute' || !attr.name) continue;
        const propName: string = typeof attr.name.name === 'string' ? attr.name.name : '';
        if (!propName) continue;

        // JSX 布尔简写：<Alert showIcon closable /> 等价于 showIcon={true} closable={true}
        if (!attr.value) {
          if (propName === 'icon') {
            props.hasIcon = true;
          } else {
            props[propName] = true;
          }
          continue;
        }

        if (propName === 'icon') {
          props.hasIcon = true;
          continue;
        }

        if (!SCALAR_PROPS.includes(propName)) continue;

        if (attr.value.type === 'StringLiteral') {
          props[propName] = attr.value.value;
        } else if (attr.value.type === 'JSXExpressionContainer') {
          const expr = attr.value.expression;
          if (expr && expr.type === 'BooleanLiteral') {
            props[propName] = expr.value;
          } else if ((propName === 'prefix' || propName === 'suffix') && expr) {
            // prefix/suffix 传入 JSX 图标或变量时，无法静态求值，但记录为 true 表示有内嵌内容，
            // 供 component-library-resolver 选择正确的"无图标=off"变体。
            props[propName] = true;
          }
          // 其他动态表达式（标识符、三元等）无法静态求值，跳过
        }
      }
    }

    // 标签内静态文案（如 <Checkbox>这是一段描述</Checkbox>）供变体库 children 族消歧
    const children = node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child.type === 'JSXText') {
          const trimmed = (child.value || '').replace(/\s+/g, ' ').trim();
          if (trimmed) {
            props.hasChildrenText = true;
            props.childrenText = trimmed;
            break;
          }
        }
      }
    }
  } catch { /* ignore */ }

  return { component: tagName, props };
}
