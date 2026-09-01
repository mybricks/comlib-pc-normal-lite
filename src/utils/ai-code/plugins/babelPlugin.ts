import * as types from "./types";
import { 
  getMapCallbackIndexParam,
  pushDataAttr,
  pushDataAttrExpression,
  getCssSelectorForJSXPath,
  extractCssClassNamesFromJSXElement,
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

/** inline 文本类 HTML 标签集合：无 className 时也允许启用样式编辑（通过祖先路径选择器 + 内联 style 写入） */
const INLINE_TEXT_TAGS = new Set([
  'span', 'strong', 'em', 'b', 'i', 's', 'small', 'mark',
  'label', 'del', 'ins', 'sub', 'sup', 'u',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p',
]);

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

export type JSXElementDataAttributes = {
  start: number
  end: number
  attributes: Record<string, string>
}

type BabelPluginOptions = {
  fileName?: string
  reactNative?: boolean
  /**
   * Compile a JSX segment in a virtual module while retaining its coordinates
   * in the original source file.
   */
  sourceOffset?: number
  lineOffset?: number
  onJSXElement?: (metadata: JSXElementDataAttributes) => void
}

function dataSetKeyToDataAttrName(key: string) {
  if (!key) return key;
  if (key.startsWith('data-')) return key;
  return `data-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

function expressionToStaticValue(node: any): any {
  if (!node) return undefined;

  switch (node.type) {
    case 'StringLiteral':
      return node.value;
    case 'NumericLiteral':
      return node.value;
    case 'BooleanLiteral':
      return node.value;
    case 'NullLiteral':
      return null;
    case 'TemplateLiteral':
      if (node.expressions?.length === 0) {
        return node.quasis?.[0]?.value?.cooked ?? node.quasis?.[0]?.value?.raw ?? '';
      }
      return undefined;
    case 'ArrayExpression':
      return (node.elements || [])
        .filter((item: any) => item != null)
        .map((item: any) => expressionToStaticValue(item));
    case 'ObjectExpression': {
      const result: Record<string, any> = {};
      for (const property of node.properties || []) {
        if (property?.type !== 'ObjectProperty') continue;
        const key = typeof property.key?.name === 'string'
          ? property.key.name
          : typeof property.key?.value === 'string'
            ? property.key.value
            : null;
        if (!key) continue;
        const value = expressionToStaticValue(property.value);
        if (value === undefined) continue;
        result[key] = value;
      }
      return result;
    }
    default:
      return undefined;
  }
}

function staticValueToString(value: any): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

const getStaticDataAttributes = (attributes: any[]) => {
  const result: Record<string, string> = {}

  attributes.forEach((attribute) => {
    if (attribute?.type !== 'JSXAttribute' || typeof attribute.name?.name !== 'string') return

    if (attribute.name.name === 'dataSet') {
      const expression = attribute.value?.type === 'JSXExpressionContainer'
        ? attribute.value.expression
        : null
      if (expression?.type !== 'ObjectExpression') return

      expression.properties.forEach((property: any) => {
        if (property?.type !== 'ObjectProperty') return

        const key = typeof property.key?.name === 'string'
          ? property.key.name
          : typeof property.key?.value === 'string'
            ? property.key.value
            : null
        if (!key) return

        const staticValue = staticValueToString(expressionToStaticValue(property.value))
        if (staticValue == null) return

        result[dataSetKeyToDataAttrName(key)] = staticValue
      })
      return
    }

    if (!attribute.name.name.startsWith('data-')) return

    if (attribute.value?.type === 'StringLiteral') {
      result[attribute.name.name] = attribute.value.value
    }
  })

  return result
}

export default function ({ fileName, sourceOffset = 0, lineOffset = 0, onJSXElement, reactNative = false }: BabelPluginOptions) {
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
    const dataAttrOptions = reactNative ? { mode: 'react-native' as const } : undefined;
    const valueForDataAttr = (name: string, value: any) => {
      return typeof value === 'string' ? value : JSON.stringify(value);
    };
    const pushDataAttrForMode = (attributes: any[], name: string, value: any) =>
      pushDataAttr(attributes, name, value, dataAttrOptions);
    const pushDataAttrExpressionForMode = (attributes: any[], name: string, identifierName: string) =>
      pushDataAttrExpression(attributes, name, identifierName, dataAttrOptions);

    return {
      visitor: {
        ImportDeclaration(path) {
          try {
            const { node } = path;
            // less 路径解析必须独立于 specifiers：
            // html-to-appref 等场景是副作用导入 `import './index.less'`（无 local 绑定），
            // 若只在 forEach(specifiers) 内处理，lessMap 永远为空，
            // 样式写入会走 resolveLessFilePath：入口 less import → 文件名兜底。
            if (node.source.value.endsWith('.less') && fileName) {
              let currentPath = fileName.split('/');
              currentPath = currentPath.slice(0, currentPath.length - 1);
              const targetPath = node.source.value.split('/');
              targetPath.forEach((seg) => {
                if (seg === '.') {
                  // keep
                } else if (seg === '..') {
                  currentPath.pop();
                } else {
                  currentPath.push(seg);
                }
              });
              lessMap.set('less', currentPath.join('/'));
            }

            node.specifiers.forEach((specifier) => {
              if (types.isImportSpecifier(specifier) || types.isImportDefaultSpecifier(specifier)) {
                importRelyMap.set(specifier.local.name, node.source.value);

                if (node.source.value.endsWith('.less')) {
                  cssModuleNames.add(specifier.local.name);
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

              let dataZoneTextEditable = hasEditableTextContent(node)
              if (sourceOffset !== 0 && dataZoneTextEditable && typeof dataZoneTextEditable === 'object') {
                dataZoneTextEditable = {
                  jsx: {
                    start: dataZoneTextEditable.jsx.start + sourceOffset,
                    end: dataZoneTextEditable.jsx.end + sourceOffset,
                  },
                }
              }

              if (dataZoneTextEditable) {
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-text-editable", valueForDataAttr("data-zone-text-editable", dataZoneTextEditable));
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
              if (sourceOffset !== 0) {
                dataLocValueObject.jsx.start += sourceOffset
                dataLocValueObject.jsx.end += sourceOffset
                dataLocValueObject.tag.end += sourceOffset
              }
              if (lineOffset !== 0) {
                dataLocValueObject.codeLine.start += lineOffset
                dataLocValueObject.codeLine.end += lineOffset
              }
              // 同时支持 className="foo" 字符串字面量 与 className={css.foo} CSS Module
              // 保持 cnList 为 string[]，data-loc 的下游消费者无需改动
              const cnList = [...new Set(extractCssClassNamesFromJSXElement(node, cssModuleNames).map(c => c.name))];
              pushDataAttrForMode(node.openingElement.attributes, "data-zone-classnames", cnList.join(' '));
              const selectors = getCssSelectorForJSXPath(path, importRelyMap, cssModuleNames);
              // fullComponentName 保留完整 JSX 组件名（如 "Input.Search"），用于 data-figma-props 变体库匹配
              const fullComponentName = getJSXElementNameString(node.openingElement.name);
              // tagName 取根对象名（如 "Input"），用于 findRelyAndSource / selector 等后续逻辑
              const tagName = fullComponentName?.split(".")[0];
              if (!tagName) {
                return;
              }

              if (tagName === 'svg') {
                pushDataAttrForMode(node.openingElement.attributes, 'data-zone-svg', 'true');
              }
              const lastSelector = selectors.length > 0 ? selectors.reverse()[0].split(' ').reverse()[0] : tagName;

              const pageRef = getPageRefForJSXPath(path, pageRefCache, fallbackName);
              if (pageRef) {
                const pageTitle = pageRef.jsdoc?.summary ?? pageRef.name ?? lastSelector;
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-title", pageTitle);
                // pushDataAttr(node.openingElement.attributes, "title", pageTitle);
                pushDataAttrForMode(node.openingElement.attributes, "data-widget-name", pageRef.name);
              } else {
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-title", lastSelector);
              }

              const popupRef = getPopupRefForJSXPath(path, popupRefCache, fallbackName);
              if (popupRef) {
                const dialogTitle = popupRef.jsdoc?.summary ?? popupRef.name ?? lastSelector;
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-title", dialogTitle);
                pushDataAttrForMode(node.openingElement.attributes, "data-widget-name", popupRef.name);
              }

              const { relyName, source } = findRelyAndSource(tagName, importRelyMap);

              // [观察下三方库的样式编辑问题]
              if (cnList.length > 0) {
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-selector", valueForDataAttr("data-zone-selector", selectors));
              } else if (
                source === 'html' &&
                INLINE_TEXT_TAGS.has(tagName) &&
                selectors.length > 0 &&
                // 子节点中无三方库组件（如 antd）时才启用，避免给复杂容器 span 打标
                !node.children.some((child: any) => {
                  if (child.type !== 'JSXElement') return false;
                  const childTag = getJSXElementNameString(child.openingElement.name)?.split('.')[0];
                  if (!childTag) return false;
                  return findRelyAndSource(childTag, importRelyMap).source !== 'html';
                })
              ) {
                // 无 className 的 inline 文本元素（span / strong / em 等）：
                // 用祖先路径 + 标签名拼成后代选择器（如 [".textTitle145 span"]），
                // 使其能被样式编辑器的 [data-zone-selector] 配置识别并展示样式面板。
                // 写入时 styleProxy 会走内联 style 注入路径，不会生成全局标签选择器规则。
                const tagSelectors = selectors.map((s: string) => `${s} ${tagName}`);
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-selector", valueForDataAttr("data-zone-selector", tagSelectors));
              } else {
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-noselector", "true");
              }
  
              if (source === "html") {
                // if (cnList.length > 0) {
                //   pushDataAttr(node.openingElement.attributes, "data-zone-selector", JSON.stringify(selectors));
                // } else {
                //   pushDataAttr(node.openingElement.attributes, "data-zone-noselector", "true");
                // }
              } else {
                pushDataAttrForMode(node.openingElement.attributes, "data-library-source", source);
                // 提取静态 JSX props，供 dom-to-figma 的变体库匹配使用。
                // 格式：{ component: "Button", props: { type: "primary", size: "large" } }
                // component 字段在消费侧用于确定性地筛选同类组件候选，避免跨组件类型误匹配。
                if (tagName && /^[A-Z]/.test(tagName)) {
                  // 使用完整组件名（如 "Input.Search"）而非基础名（"Input"），确保变体库匹配时能区分子组件
                  const figmaPropsPayload = extractFigmaProps(node, fullComponentName || tagName);
                  pushDataAttrForMode(node.openingElement.attributes, "data-figma-props", valueForDataAttr("data-figma-props", figmaPropsPayload));
                }
                // 识别第三方图标组件：包名含 icon(s) 或组件名以图标风格后缀结尾
                const isIconPkg = /icons?$/i.test(source);
                const isIconName = /(?:Line|Fill|Filled|Outlined|Solid|Outline|TwoTone|Sharp|Icon)$/.test(tagName);
                if (isIconPkg || isIconName) {
                  pushDataAttrForMode(node.openingElement.attributes, "data-zone-icon", tagName);
                }
              }
  
              if (cnList.length > 0) {
                dataLocValueObject.cn = cnList
                
  
                // 仅当当前 JSX 是「组件根节点」时挂 JSDoc（summary、@prop），并写入 data-loc，供聚焦时读取；按组件缓存避免重复计算
                // const jsdoc = getComRefForJSXPath(path, componentJsdocCache);
                // if (jsdoc) {
                //   dataLocValueObject.jsdoc = jsdoc;
                // }
  
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
                  pushDataAttrExpressionForMode(node.openingElement.attributes, "data-map-index", mapIndexParam);
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
                pushDataAttrForMode(node.openingElement.attributes, "data-com-name", comRef.name);

                pushDataAttrForMode(node.openingElement.attributes, "data-widget-name", comRef.name);

  
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
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-events", valueForDataAttr("data-zone-events", events));
                // 用于展示事件小黄点
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-docs-events", valueForDataAttr("data-zone-docs-events", events.length));
              }

              if (datasource) {
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-datasource", datasource);
              }

              if (store) {
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-store", store);
              }

              // if (comRef) {
              //   pushDataAttr(node.openingElement.attributes, "data-zone-docs", JSON.stringify({...comRef.jsdoc, events: dataZoneDocsEvents}));
              // } else {
              //   pushDataAttr(node.openingElement.attributes, "data-zone-docs", JSON.stringify({events: dataZoneDocsEvents}));
              // }
  
              if (zoneType !== "page") {
                pushDataAttrForMode(node.openingElement.attributes, "data-zone-type", zoneType);
              }

              // ── 可交换性标记 ────────────────────────────────────────────────
              // 通过 AST 精确判断该 JSX 节点能否安全做字符串位置互换（不走 AI）。
              // 规则：
              //   父路径是 VariableDeclarator（const h1 = <h1>）→ 不可换（赋值右值）
              //   从当前节点向上、在遇到父级 JSXElement 之前，若经过 JSXExpressionContainer，
              //     说明该节点被包在 {num > 3 ? <div>...</div> : null} 这类三元/逻辑表达式内
              //     → 不可换，直接字符串替换会把另一个节点塞进条件分支里
              //   其余情况 → 可换
              //
              // 注意：含 {h1} 等 JSXExpressionContainer 子节点的节点仍可换，
              // 因为我们交换的是整个子树，表达式引用跟着一起移动，作用域不变。
              const isAssignmentRhs = path.parentPath?.isVariableDeclarator() === true;
              // 向上遍历，直到遇到父级 JSXElement 为止；
              // 若中途经过 JSXExpressionContainer，说明当前节点嵌套在条件/逻辑表达式中，
              // 直接字符串替换会破坏条件结构。
              let isInsideJSXExpression = false;
              {
                let cur = path.parentPath;
                while (cur) {
                  if (cur.isJSXElement()) break; // 遇到父 JSXElement 则停止
                  if (cur.isJSXExpressionContainer()) {
                    isInsideJSXExpression = true;
                    break;
                  }
                  cur = cur.parentPath;
                }
              }
              dataLocValueObject.swappable = !isAssignmentRhs && !isInsideJSXExpression;
              // ────────────────────────────────────────────────────────────────

              pushDataAttrForMode(node.openingElement.attributes, "data-loc", valueForDataAttr("data-loc", dataLocValueObject));

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
                pushDataAttrForMode(node.openingElement.attributes, "data-widge-name", popupName);
              }

              onJSXElement?.({
                start: node.start + sourceOffset,
                end: node.end + sourceOffset,
                attributes: getStaticDataAttributes(node.openingElement.attributes),
              })
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
          exit(path) {
            // 解析/遍历结束：整棵 AST 已访问完，importRecord 等已收集完毕
            // 收集来自图标包的所有导入（包名含 icon/icons），按 source 分组
            const iconImportsBySource = new Map<string, string[]>()
            for (const [localName, source] of importRelyMap.entries()) {
              if (typeof source !== 'string' || !source) continue
              if (cssModuleNames.has(localName)) continue
              if (/icons?$/i.test(source)) {
                let names = iconImportsBySource.get(source)
                if (!names) { names = []; iconImportsBySource.set(source, names) }
                names.push(localName)
              }
            }
            // 为每个图标包注入：window.__MB_REGISTER_ICONS__ && window.__MB_REGISTER_ICONS__(source, { Icon1, Icon2 })
            for (const [source, names] of iconImportsBySource.entries()) {
              if (!names.length) continue
              const windowId = { type: 'Identifier', name: 'window' }
              const registerProp = { type: 'Identifier', name: '__MB_REGISTER_ICONS__' }
              const callee = { type: 'MemberExpression', object: windowId, property: registerProp, computed: false }
              path.node.body.push({
                type: 'ExpressionStatement',
                expression: {
                  type: 'LogicalExpression',
                  operator: '&&',
                  left: { type: 'MemberExpression', object: { type: 'Identifier', name: 'window' }, property: { type: 'Identifier', name: '__MB_REGISTER_ICONS__' }, computed: false },
                  right: {
                    type: 'CallExpression',
                    callee,
                    arguments: [
                      { type: 'StringLiteral', value: source },
                      {
                        type: 'ObjectExpression',
                        properties: names.map(name => ({
                          type: 'ObjectProperty',
                          key: { type: 'Identifier', name },
                          value: { type: 'Identifier', name },
                          shorthand: true,
                          computed: false,
                        })),
                      },
                    ],
                  },
                },
              } as any)
            }
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
