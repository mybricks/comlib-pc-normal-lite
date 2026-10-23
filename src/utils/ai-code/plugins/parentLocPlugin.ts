import { pushDataAttr } from './utils';

const REF_NAMES = new Set(['appRef', 'comRef', 'popupRef']);

function isComponent(path: any): boolean {
  const parent = path.parentPath;
  if (parent?.isCallExpression() && parent.node.arguments[0] === path.node) {
    const callee = parent.node.callee;
    if (REF_NAMES.has(callee.name ?? callee.property?.name)) return true;
  }

  const name = path.node.id?.name ??
    (parent?.isVariableDeclarator() ? parent.node.id?.name : undefined);
  return typeof name === 'string' && /^[A-Z]/.test(name);
}

function addToRoot(expression: any, value: any, t: any, reactNative: boolean): void {
  if (!expression) return;

  if (t.isJSXElement(expression)) {
    const attributes = expression.openingElement.attributes;
    if (attributes.some((attr: any) => t.isJSXAttribute(attr) && attr.name.name === 'data-parent-loc')) return;

    if (reactNative) {
      pushDataAttr(attributes, 'data-parent-loc', value, { mode: 'react-native' });
    } else {
      attributes.push(t.jsxAttribute(
        t.jsxIdentifier('data-parent-loc'),
        t.jsxExpressionContainer(t.cloneNode(value)),
      ));
    }
    return;
  }

  if (t.isJSXFragment(expression)) {
    expression.children.forEach((child: any) => addToRoot(child, value, t, reactNative));
  } else if (t.isConditionalExpression(expression)) {
    addToRoot(expression.consequent, value, t, reactNative);
    addToRoot(expression.alternate, value, t, reactNative);
  } else if (t.isLogicalExpression(expression)) {
    addToRoot(expression.left, value, t, reactNative);
    addToRoot(expression.right, value, t, reactNative);
  } else if (t.isSequenceExpression(expression)) {
    addToRoot(expression.expressions[expression.expressions.length - 1], value, t, reactNative);
  } else if (t.isParenthesizedExpression(expression) || t.isTSAsExpression(expression) || t.isTSTypeAssertion(expression)) {
    addToRoot(expression.expression, value, t, reactNative);
  }
}

export default function parentLocPlugin({ reactNative = false }: { reactNative?: boolean } = {}) {
  return function ({ types: t }: { types: any }) {
    function visitComponent(path: any) {
      if (!isComponent(path) || !t.isIdentifier(path.node.params[0])) return;

      const value = t.memberExpression(
        t.identifier(path.node.params[0].name),
        t.stringLiteral('data-loc'),
        true,
      );
      if (!t.isBlockStatement(path.node.body)) {
        addToRoot(path.node.body, value, t, reactNative);
      } else {
        path.traverse({
          ReturnStatement(returnPath: any) {
            if (returnPath.getFunctionParent() === path) {
              addToRoot(returnPath.node.argument, value, t, reactNative);
            }
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
