/**
 * wrapReactNativeComponentPlugin
 *
 * 一个 Babel 插件，用于在可视化编辑器场景下对 React Native 组件进行包裹处理。
 *
 * 核心功能：
 *   将所有来自 `react-native` 的组件对应的 `React.createElement(RNComponent, ...)` 调用，
 *   外部再包一层透明 `div`：
 *
 *   // 转换前
 *   React.createElement(View, { style: ... }, ...)
 *
 *   // 转换后
 *   React.createElement(
 *     "div",
 *     { style: { display: "contents" }, "data-zone-selector": '["wrapper"]' },
 *     React.createElement(View, { style: ... }, ...)
 *   )
 *
 * 设计目标：
 *   - `display: contents` 使 wrapper div 在视觉上完全透明，不影响布局。
 *   - `data-zone-selector` 供编辑器识别 wrapper 节点，实现区域选中、样式映射等能力。
 *
 * 支持的导入形式：
 *   - ESM 命名导入：  import { View, Text } from 'react-native'
 *   - ESM 命名空间：  import * as RN from 'react-native'
 *   - CJS 解构：      const { View } = require('react-native')
 *   - CJS 整体：      const RN = require('react-native')
 *
 * 执行阶段：
 *   插件在 Program exit 阶段完成包裹，确保 Babel 已将 JSX 编译为
 *   React.createElement 调用后再进行处理，兼容先 JSX transform 再执行本插件的场景。
 */

import { injectPositionInfoIntoStyleNode, injectFilenameIntoStyleNode } from './stylePropInfoUtils';

// ─── 深克隆 ───────────────────────────────────────────────────────────────────

/**
 * 深克隆一个 AST 节点（通过 JSON 序列化实现）。
 * 用于生成 wrapper 节点时，将原始 RN 组件节点作为子节点插入，
 * 避免同一 AST 节点被多处引用导致遍历异常。
 */
function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node));
}

/**
 * 构造 `React.createElement` 的 callee AST 节点（MemberExpression）。
 * 即 `React.createElement` 这个表达式本身。
 */
function createReactCreateElementCallee() {
  return {
    type: "MemberExpression",
    object: { type: "Identifier", name: "React" },
    property: { type: "Identifier", name: "createElement" },
    computed: false,
  };
}

/**
 * 从 React.createElement 的第二个参数（props ObjectExpression）中提取 style 属性的 AST 值节点。
 * 支持 Identifier key（style）和 StringLiteral key（"style"）两种形式。
 *
 * @param props - createElement 的第二个参数 AST 节点
 * @returns style 属性值 AST 节点，若不存在则返回 null
 */
function extractStyleFromProps(props: any): any | null {
  if (!props || props.type !== "ObjectExpression") return null;

  for (const prop of props.properties || []) {
    if (prop.type !== "ObjectProperty") continue;
    const key = prop.key;
    const isStyleKey =
      (key?.type === "Identifier" && key.name === "style") ||
      (key?.type === "StringLiteral" && key.value === "style");
    if (isStyleKey) {
      return prop.value ?? null;
    }
  }
  return null;
}

/**
 * 构造 wrapper div 的 props AST 节点（ObjectExpression）。
 * 生成的 props 对象等价于：
 * {
 *   style: { display: "contents" },
 *   "data-zone-selector": '["wrapper"]',
 *   "data-rn-style": <被包装 RN 组件的 style 值>  // 仅当 rnStyleNode 存在时
 * }
 *
 * - `display: contents`：使 div 在布局上透明，不影响子元素。
 * - `data-zone-selector`：供编辑器识别此节点为 wrapper 区域。
 * - `data-rn-style`：复制内层 RN 组件的 style 值，供编辑器读取原始样式。
 *   key 使用 StringLiteral（而非 Identifier），因为连字符不是合法标识符。
 *
 * @param rnStyleNode - 被包装 RN 组件的 style 属性值 AST 节点（可选）
 */
function createDisplayContentsStyleProps(rnStyleNode?: any) {
  const properties: any[] = [
    {
      type: "ObjectProperty",
      key: { type: "Identifier", name: "style" },
      value: {
        type: "ObjectExpression",
        properties: [
          {
            type: "ObjectProperty",
            key: { type: "Identifier", name: "display" },
            value: { type: "StringLiteral", value: "contents" },
            computed: false,
            shorthand: false,
          },
        ],
      },
      computed: false,
      shorthand: false,
    },
    {
      type: "ObjectProperty",
      // 连字符不合法作为 Identifier，必须用 StringLiteral
      key: { type: "StringLiteral", value: "data-zone-selector" },
      value: { type: "StringLiteral", value: JSON.stringify(["wrapper"]) },
      computed: false,
      shorthand: false,
    },
  ];

  // 若内层 RN 组件存在 style 属性，将其值复制到 data-rn-style
  if (rnStyleNode != null) {
    properties.push({
      type: "ObjectProperty",
      key: { type: "StringLiteral", value: "data-rn-style" },
      // 生成 JSON.stringify(<rnStyleNode>) 的 CallExpression，运行时序列化 style 值
      value: {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          object: { type: "Identifier", name: "JSON" },
          property: { type: "Identifier", name: "stringify" },
          computed: false,
        },
        arguments: [cloneNode(rnStyleNode)],
      },
      computed: false,
      shorthand: false,
    });
  }

  return {
    type: "ObjectExpression",
    properties,
  };
}

/**
 * 构造一个完整的 `React.createElement(tag, props, ...children)` 调用 AST 节点。
 * 添加 `#__PURE__` 注释，供 Tree Shaking 工具识别为纯函数调用，避免副作用标记。
 *
 * @param tag      - 标签 AST 节点（如 StringLiteral "div" 或 Identifier "View"）
 * @param props    - props AST 节点（ObjectExpression）
 * @param children - 子节点数组（默认为空）
 */
function createReactCreateElementCall(tag: any, props: any, children: any[] = []) {
  return {
    type: "CallExpression",
    callee: createReactCreateElementCallee(),
    arguments: [tag, props, ...children],
    leadingComments: [{ type: "CommentBlock", value: "#__PURE__" }],
  };
}

/**
 * 判断一个 AST 节点是否为 `React.createElement(...)` 调用。
 * 通过检查 callee 是否为 `React.createElement` MemberExpression 来识别。
 *
 * @param node - 待检测的 AST 节点
 */
function isReactCreateElementCall(node: any) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "React" &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "createElement"
  );
}

/**
 * 从 `require(...)` 表达式中递归提取模块来源字符串。
 * 支持以下形式：
 *   - require('react-native')                        → "react-native"
 *   - require('react-native').default                → 递归取 arguments[0]
 *   - interopRequireDefault(require('react-native')) → 递归取 arguments[0]
 *
 * @param expression - 待解析的表达式 AST 节点
 * @returns 模块来源字符串，若无法识别则返回 null
 */
function createRequireSourceFromExpression(expression: any): string | null {
  // 直接的 require("xxx") 形式
  if (
    expression?.type === "CallExpression" &&
    expression.callee?.type === "Identifier" &&
    expression.callee.name === "require" &&
    expression.arguments?.[0]?.type === "StringLiteral"
  ) {
    return expression.arguments[0].value;
  }

  // 嵌套调用形式，如 interopRequireDefault(require("xxx"))，递归提取
  if (
    expression?.type === "CallExpression" &&
    expression.arguments?.[0]
  ) {
    return createRequireSourceFromExpression(expression.arguments[0]);
  }

  return null;
}

/**
 * 处理 ESM `import` 声明，收集来自 `react-native` 的本地绑定名称。
 *
 * - 命名导入（ImportSpecifier）：`import { View, Text } from 'react-native'`
 *   → 将 View、Text 标记为 "component"
 * - 命名空间导入（ImportNamespaceSpecifier）：`import * as RN from 'react-native'`
 *   → 将 RN 标记为 "namespace"
 *
 * @param path                   - ImportDeclaration 的 Babel path
 * @param reactNativeComponentMap - 收集结果的 Map
 */
function collectImportDeclaration(path: any, reactNativeComponentMap: Map<string, "component" | "namespace">) {
  if (path.node.source?.value !== "react-native") return;

  for (const specifier of path.node.specifiers || []) {
    const localName = specifier.local?.name;
    if (!localName) continue;

    if (specifier.type === "ImportSpecifier") {
      // 命名导入：import { View } from 'react-native'
      reactNativeComponentMap.set(localName, "component");
    } else if (specifier.type === "ImportNamespaceSpecifier") {
      // 命名空间导入：import * as RN from 'react-native'
      reactNativeComponentMap.set(localName, "namespace");
    }
  }
}

/**
 * 处理 CJS `require` 形式的变量声明，收集来自 `react-native` 的本地绑定名称。
 *
 * - 整体赋值（Identifier）：`const RN = require('react-native')`
 *   → 将 RN 标记为 "namespace"
 * - 解构赋值（ObjectPattern）：`const { View, Text } = require('react-native')`
 *   → 将 View、Text 标记为 "component"
 *
 * @param path                   - VariableDeclarator 的 Babel path
 * @param reactNativeComponentMap - 收集结果的 Map
 */
function collectVariableDeclarator(path: any, reactNativeComponentMap: Map<string, "component" | "namespace">) {
  const { id, init } = path.node;
  const requireSource = createRequireSourceFromExpression(init);
  if (requireSource !== "react-native") return;

  if (id?.type === "Identifier") {
    // const RN = require('react-native')
    reactNativeComponentMap.set(id.name, "namespace");
    return;
  }

  if (id?.type === "ObjectPattern") {
    // const { View, Text: MyText } = require('react-native')
    for (const property of id.properties || []) {
      if (property?.type !== "ObjectProperty") continue;
      const localName = property.value?.type === "Identifier" ? property.value.name : null;
      if (localName) {
        reactNativeComponentMap.set(localName, "component");
      }
    }
  }
}

/**
 * 判断 `React.createElement` 的第一个参数（tag）是否为 React Native 组件。
 *
 * - Identifier 形式：`React.createElement(View, ...)` → View 在 Map 中标记为 "component"
 * - MemberExpression 形式：`React.createElement(RN.View, ...)` → RN 在 Map 中标记为 "namespace"
 *
 * @param tag                    - createElement 第一个参数的 AST 节点
 * @param reactNativeComponentMap - 已收集的 RN 绑定 Map
 */
function isReactNativeCreateElementTag(tag: any, reactNativeComponentMap: Map<string, "component" | "namespace">) {
  if (tag?.type === "Identifier") {
    return reactNativeComponentMap.get(tag.name) === "component";
  }

  if (
    tag?.type === "MemberExpression" &&
    tag.object?.type === "Identifier" &&
    reactNativeComponentMap.get(tag.object.name) === "namespace"
  ) {
    return true;
  }

  return false;
}

/**
 * 对识别为 React Native 组件的 `React.createElement` 调用进行 wrapper 包裹。
 *
 * 包裹逻辑：
 *   原始：React.createElement(View, { style: styles.footer }, ...children)
 *   结果：React.createElement("div",
 *           { style: { display: "contents" }, "data-zone-selector": '["wrapper"]', "data-rn-style": styles.footer },
 *           React.createElement(View, { style: styles.footer }, ...children)  // 深克隆原始节点
 *         )
 *
 * data-rn-style 说明：
 *   将内层 RN 组件的 style 属性值原样复制到 wrapper div 的 data-rn-style 上，
 *   供编辑器读取原始样式信息，用于样式定位与修改。若内层无 style 属性则省略该属性。
 *
 * 为什么在 exit 阶段执行：
 *   在 exit 阶段，当前节点的所有子节点已经完成遍历和处理。
 *   这样可以保证子组件先被包裹，父组件再被包裹，从内到外处理。
 *
 * 为什么调用 path.skip()：
 *   `path.replaceWith` 替换后，Babel 会重新遍历新节点（replacement）。
 *   新节点的 children 中包含了原始 RN 节点的克隆，若不 skip，会再次命中
 *   该克隆节点并递归包裹，形成无限嵌套。exit 阶段的 skip 不影响已处理完的子节点。
 *
 * @param path                   - CallExpression 的 Babel path
 * @param reactNativeComponentMap - 已收集的 RN 绑定 Map
 * @param filename               - 当前编译文件路径（来自 Babel state.filename）
 */
function wrapCreateElementCall(path: any, reactNativeComponentMap: Map<string, "component" | "namespace">, filename: string) {
  const node = path.node;
  if (!isReactCreateElementCall(node)) return;

  const [tag] = node.arguments || [];
  if (!isReactNativeCreateElementTag(tag, reactNativeComponentMap)) return;

  // 提取内层 RN 组件的 style 值，复制到 wrapper div 的 data-rn-style 属性
  const innerProps = node.arguments[1] ?? null;
  const rnStyleNode = extractStyleFromProps(innerProps);

  // 对 style 值中的 inline ObjectExpression 注入位置信息（_<propName>）和 _filename
  // 覆盖场景：style={[styles.xxx, { color: 'pink' }]} 中的 inline 对象
  if (rnStyleNode != null) {
    injectPositionInfoIntoStyleNode(rnStyleNode);
    injectFilenameIntoStyleNode(rnStyleNode, filename);
  }

  path.replaceWith(
    createReactCreateElementCall(
      { type: "StringLiteral", value: "div" },
      createDisplayContentsStyleProps(rnStyleNode ?? undefined),
      [cloneNode(node)],
    ),
  );

  // 新 wrapper 的 child 是当前 RN 组件的 clone，如果继续遍历 replacement 会再次命中同一个 RN 组件，导致递归包裹。
  // 这里在 exit 阶段 skip，不会影响原始子节点先被处理。
  path.skip();
}

/**
 * Babel 插件工厂函数：wrapReactNativeComponentPlugin
 *
 * 使用方式（在 Babel 配置或代码中）：
 *   plugins: [wrapReactNativeComponentPlugin()]
 *
 * 执行流程：
 *   1. pre()：每次编译文件前重置 reactNativeComponentMap。
 *   2. visitor.ImportDeclaration：收集 ESM import 中的 RN 绑定。
 *   3. visitor.VariableDeclarator：收集顶层 CJS require 绑定（处理部分提前出现的场景）。
 *   4. visitor.Program exit：
 *      a. 再次遍历收集 VariableDeclarator（兜底，确保编译后的 CJS 形式也被捕获）。
 *      b. 在 CallExpression exit 阶段对所有 RN 组件进行 wrapper 包裹。
 *
 * 注意：
 *   - 本插件设计为在 JSX transform（@babel/plugin-transform-react-jsx）之后运行，
 *     此时 JSX 已被编译为 React.createElement 调用，插件直接操作 CallExpression。
 *   - 若在 JSX transform 之前运行，JSX 节点尚未展开，插件将无法识别。
 */
export default function wrapReactNativeComponentPlugin() {
  return function () {
    /** 存储从 `react-native` 导入的本地绑定名称及其类型（component / namespace） */
    let reactNativeComponentMap: Map<string, "component" | "namespace">;
    /** 当前编译文件路径，由 Babel state.filename 提供 */
    let filename: string;

    return {
      /** 每个文件编译前重置绑定收集 Map 及 filename */
      pre(state: any) {
        reactNativeComponentMap = new Map();
        filename = state.opts.filename.replace(/^\//, '');
      },
      visitor: {
        /** 收集 ESM import 形式的 RN 绑定 */
        ImportDeclaration(path) {
          collectImportDeclaration(path, reactNativeComponentMap);
        },
        /** 收集顶层 CJS require 形式的 RN 绑定（兜底） */
        VariableDeclarator(path) {
          collectVariableDeclarator(path, reactNativeComponentMap);
        },
        Program: {
          /**
           * 在整个 Program 退出时执行包裹逻辑。
           * 此时 JSX 已被编译，所有 React.createElement 调用已存在于 AST 中。
           * 使用 path.traverse 进行二次遍历，在 CallExpression exit 阶段
           * 从内到外依次对 RN 组件进行 wrapper 包裹。
           */
          exit(path) {
            path.traverse({
              VariableDeclarator(variablePath) {
                collectVariableDeclarator(variablePath, reactNativeComponentMap);
              },
              CallExpression: {
                exit(callPath) {
                  wrapCreateElementCall(callPath, reactNativeComponentMap, filename);
                },
              },
            });
          },
        },
      },
    };
  };
}
