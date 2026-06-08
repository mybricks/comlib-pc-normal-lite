/**
 * Babel 插件：识别非三方库 UI 组件，并在其外层包裹一层 `React.createElement('div', { style: { display: 'contents' } }, ...)` 。
 *
 * 「非三方库 UI 组件」的判定标准：
 *   1. JSX 标签名首字母大写（排除原生 HTML 标签）
 *   2. 满足以下任一条件：
 *      a. 由相对路径 import 引入（import path 以 `.` 或 `..` 开头）
 *      b. 通过 comRef(...) / popupRef(...) 在文件内声明
 *
 * 包裹结果（不影响布局）：
 *   原始：<Com prop="xxx" />  →  React.createElement(Com, { prop: 'xxx' })
 *   包裹：React.createElement('div', { 'data-custom-com-wrapper': '{"fileName":"...","jsx":{"start":...,"end":...}}', style: { display: 'contents' } }, React.createElement(Com, ...))
 *
 * 注意：本插件工作在 JSX transform（@babel/preset-react）之后，因此直接操作
 *       React.createElement CallExpression 节点，而非 JSXElement 节点。
 *
 * 幂等保护：若某 React.createElement 调用已处于 wrapper 内则跳过，避免重复包裹。
 */

import { isComRefCall, isPopupRefCall } from './utils/comRef';

/** 标记 wrapper 的特殊属性名，用于幂等检测 */
const WRAPPER_MARKER = 'data-custom-com-wrapper';

/**
 * 判断当前 path 是否是 .map() 回调函数的【直接】返回节点。
 *
 * 只检查最近一层函数是否是 .map() 的回调，
 * 中间如果隔了另一个 React.createElement（即嵌套 JSX 元素），立即停止。
 * 这样保证内部子元素（如 map 返回的 div 内部的 div）不会被误标。
 *
 * @example
 * // ✅ 返回 true：<MyComp /> 是 .map() 回调的直接返回值
 * //
 * // JSX 写法：
 * //   items.map(item => <MyComp key={item.id} />)
 * //
 * // 经 JSX transform 后等价于：
 * //   items.map(item => React.createElement(MyComp, { key: item.id }))
 * //                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 * //                      此节点的 isInsideMapCallback() === true
 *
 * @example
 * // ❌ 返回 false：<Inner /> 不是 .map() 回调的直接返回值，中间隔了 <div>
 * //
 * // JSX 写法：
 * //   items.map(item => (
 * //     <div key={item.id}>
 * //       <Inner />          ← 不应被标记为 isMap
 * //     </div>
 * //   ))
 * //
 * // 经 JSX transform 后等价于：
 * //   items.map(item =>
 * //     React.createElement('div', { key: item.id },
 * //       React.createElement(Inner, null)   ← isInsideMapCallback() === false
 * //     )                                       （因为向上遇到了外层 createElement 就停止）
 * //   )
 */
export function isInsideMapCallback(path: any): boolean {
  let cur = path.parentPath;
  while (cur) {
    const { node } = cur;

    // 遇到函数节点，检查它的父调用是否是 .map()
    if (
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'FunctionExpression'
    ) {
      const parentCall = cur.parentPath?.node;
      return (
        parentCall?.type === 'CallExpression' &&
        parentCall.callee?.type === 'MemberExpression' &&
        parentCall.callee.property?.name === 'map'
      );
    }

    // 遇到另一个 React.createElement 调用（即中间隔了一层 JSX 元素），停止向上
    if (isReactCreateElement(node)) {
      return false;
    }

    cur = cur.parentPath;
  }
  return false;
}

/**
 * 判断一个 CallExpression 是否是 React.createElement 调用
 */
function isReactCreateElement(node: any): boolean {
  return (
    node.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.object?.name === 'React' &&
    node.callee.property?.name === 'createElement'
  );
}

/**
 * 判断一个 React.createElement 调用是否已经是 wrapper div（幂等检测）
 * wrapper 形如：React.createElement('div', { 'data-custom-com-wrapper': '{...}', ... }, ...)
 */
function isWrapperDiv(node: any): boolean {
  if (!isReactCreateElement(node)) return false;
  const firstArg = node.arguments?.[0];
  if (!firstArg || firstArg.type !== 'StringLiteral' || firstArg.value !== 'div') return false;
  const propsArg = node.arguments?.[1];
  if (!propsArg || propsArg.type !== 'ObjectExpression') return false;
  return propsArg.properties?.some(
    (prop: any) =>
      prop.type === 'ObjectProperty' &&
      (prop.key?.value === WRAPPER_MARKER || prop.key?.name === WRAPPER_MARKER)
  );
}

/**
 * 构造 wrapper div 的 AST 节点：
 *   React.createElement('div', { 'data-custom-com-wrapper': '1', style: { display: 'contents' } }, child)
 */
function buildWrapperElement(t: any, child: any, params: { fileName: string, isMap: boolean }): any {
  const { fileName, isMap } = params
  const markerValue = JSON.stringify({
    fileName, 
    jsx: { start: child.start, end: child.end },
    isMap,
    codeLine: {
      start: child.loc.start.line,
      end: child.loc.end.line
    },
  });
  const propsObj = t.objectExpression([
    t.objectProperty(
      t.stringLiteral(WRAPPER_MARKER),
      t.stringLiteral(markerValue)
    ),
    t.objectProperty(
      t.identifier('style'),
      t.objectExpression([
        t.objectProperty(
          t.identifier('display'),
          t.stringLiteral('contents')
        ),
      ])
    ),

  ]);

  return t.callExpression(
    t.memberExpression(t.identifier('React'), t.identifier('createElement')),
    [t.stringLiteral('div'), propsObj, child]
  );
}

export default function wrapCustomComponentPlugin({ fileName }) {
  return function ({ types: t }: { types: any }) {
    /** 相对路径引入的组件名集合：import Foo from './Foo' */
    const relativeImportedComponents = new Set<string>();
    /** comRef / popupRef 声明的组件名集合：const Bar = comRef(...) */
    const localRefComponents = new Set<string>();

    return {
      visitor: {
        /** 收集相对路径 import 的组件名 */
        ImportDeclaration(path: any) {
          try {
            const source: string = path.node.source.value;
            // 只关注相对路径（以 . 开头），排除三方库（antd、lodash 等）
            if (!source.startsWith('.')) return;

            path.node.specifiers.forEach((specifier: any) => {
              if (
                specifier.type === 'ImportDefaultSpecifier' ||
                specifier.type === 'ImportSpecifier'
              ) {
                const localName: string = specifier.local.name;
                // 只记录首字母大写的（组件名约定）
                if (/^[A-Z]/.test(localName)) {
                  relativeImportedComponents.add(localName);
                }
              }
            });
          } catch {
            // 静默处理
          }
        },

        /** 收集 comRef / popupRef 声明的组件名 */
        VariableDeclarator(path: any) {
          try {
            const { id, init } = path.node;
            if (!id || id.type !== 'Identifier') return;
            if (!init || init.type !== 'CallExpression') return;
            if (isComRefCall(init.callee) || isPopupRefCall(init.callee)) {
              localRefComponents.add(id.name as string);
            }
          } catch {
            // 静默处理
          }
        },

        /**
         * 在 React.createElement(Component, ...) 调用时判断是否需要包裹。
         * 此时 JSX 已被 preset-react 转换完毕，直接操作 CallExpression。
         */
        CallExpression: {
          enter(path: any) {
            try {
              const { node } = path;

              // 必须是 React.createElement 调用
              if (!isReactCreateElement(node)) return;

              // 第一个参数是组件引用（Identifier），且首字母大写
              const firstArg = node.arguments?.[0];
              if (!firstArg || firstArg.type !== 'Identifier') return;
              const tagName: string = firstArg.name;
              if (!/^[A-Z]/.test(tagName)) return;

              // 判断是否为「非三方库」组件
              const isRelativeImport = relativeImportedComponents.has(tagName);
              const isLocalRef = localRefComponents.has(tagName);
              if (!isRelativeImport && !isLocalRef) return;

              // 幂等保护：父节点已经是 wrapper div 则跳过
              const parentNode = path.parent;
              if (isWrapperDiv(parentNode)) return;

              // 包裹
              const isMap = isInsideMapCallback(path);
              const wrapper = buildWrapperElement(t, node, {fileName, isMap});
              path.replaceWith(wrapper);

              // replaceWith 之后跳过新节点，避免无限递归
              path.skip();
            } catch {
              // 静默处理解析错误
            }
          },
        },
      },
    };
  };
}
