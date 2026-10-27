import { pushDataAttr } from './utils';

/** 仅标记自身取得状态的组件，标记本身不表示已接入 mock。 */
const REF_NAMES = new Set(['appRef', 'comRef', 'pageRef', 'popupRef']);
const STATE_HOOKS = new Set([
  'useState', 'useReducer', 'useContext', 'useSyncExternalStore',
  'useTransition', 'useDeferredValue',
]);
const NON_STATE_HOOKS = new Set([
  'useCallback', 'useDebugValue', 'useEffect', 'useId', 'useImperativeHandle',
  'useInsertionEffect', 'useLayoutEffect', 'useMemo', 'useRef',
  'useWindowProxy', 'useNavigate', 'useDispatch',
]);

function getCalleeName(callee: any): string | undefined {
  if (callee?.type === 'Identifier') return callee.name;
  if (callee?.type === 'MemberExpression' && !callee.computed) return callee.property?.name;
}

function isComponent(path: any): boolean {
  const parent = path.parentPath;
  if (parent?.isCallExpression() && parent.node.arguments[0] === path.node &&
    REF_NAMES.has(getCalleeName(parent.node.callee))) return true;

  const name = path.node.id?.name ??
    (parent?.isVariableDeclarator() ? parent.node.id?.name : undefined);
  return typeof name === 'string' && /^[A-Z]/.test(name);
}

function hasStateSource(path: any): boolean {
  // props 的值由调用侧决定，不作为当前组件的状态来源。
  let found = false;
  path.traverse({
    Function(inner: any) {
      // 内部函数可能是事件回调或另一个组件，其 Hook 不属于当前组件。
      if (inner !== path) inner.skip();
    },
    CallExpression(call: any) {
      if (found) return;
      const name = getCalleeName(call.node.callee);
      if (!name || !/^use[A-Z]/.test(name)) return;
      if (STATE_HOOKS.has(name)) {
        found = true;
      } else if (!NON_STATE_HOOKS.has(name) && !call.parentPath.isExpressionStatement()) {
        // 被使用的自定义 Hook 返回值可能包含数据、加载态或错误态。
        found = true;
      }
    },
  });
  return found;
}

function markRoot(node: any, t: any, reactNative: boolean): void {
  // 沿返回表达式展开条件分支与 Fragment，只标记每条路径的最外层 JSX。
  if (!node) return;
  if (t.isJSXElement(node)) {
    const attributes = node.openingElement.attributes;
    if (!attributes.some((attr: any) => t.isJSXAttribute(attr) && attr.name.name === 'data-zone-status')) {
      if (reactNative) {
        pushDataAttr(attributes, 'data-zone-status', true, { mode: 'react-native' });
      } else {
        attributes.push(t.jsxAttribute(
          t.jsxIdentifier('data-zone-status'),
          t.jsxExpressionContainer(t.booleanLiteral(true)),
        ));
      }
    }
  } else if (t.isJSXFragment(node)) {
    node.children.forEach((child: any) => {
      if (t.isJSXElement(child) || t.isJSXFragment(child)) markRoot(child, t, reactNative);
      else if (t.isJSXExpressionContainer(child)) markRoot(child.expression, t, reactNative);
    });
  } else if (t.isConditionalExpression(node)) {
    markRoot(node.consequent, t, reactNative);
    markRoot(node.alternate, t, reactNative);
  } else if (t.isLogicalExpression(node)) {
    markRoot(node.left, t, reactNative);
    markRoot(node.right, t, reactNative);
  } else if (t.isParenthesizedExpression(node) || t.isTSAsExpression(node) || t.isTSTypeAssertion(node)) {
    markRoot(node.expression, t, reactNative);
  } else if (t.isSequenceExpression(node)) {
    markRoot(node.expressions[node.expressions.length - 1], t, reactNative);
  } else if (t.isArrayExpression(node)) {
    node.elements.forEach((element: any) => markRoot(element, t, reactNative));
  }
}

export default function zoneStatusPlugin({ reactNative = false }: { reactNative?: boolean } = {}) {
  return function ({ types: t }: { types: any }) {
    function visitComponent(path: any) {
      if (!isComponent(path) || !hasStateSource(path)) return;

      const body = path.get('body');
      if (!body.isBlockStatement()) {
        markRoot(body.node, t, reactNative);
      } else {
        body.traverse({
          Function(inner: any) { inner.skip(); },
          ReturnStatement(returnPath: any) {
            markRoot(returnPath.node.argument, t, reactNative);
          },
        });
      }
    }

    return {
      visitor: {
        FunctionDeclaration: visitComponent,
        FunctionExpression: visitComponent,
        ArrowFunctionExpression: visitComponent,
      },
    };
  };
}
