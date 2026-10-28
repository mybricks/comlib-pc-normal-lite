/**
 * 为读取 window._proxy_ 的 React 组件注入 useWindowProxy Hook。
 *
 * windowProxyStore 负责维护代理对象和订阅状态；本插件只负责在编译期
 * 找到候选组件并添加 Hook 调用及对应的 import。
 */

const PROXY_PROPERTY = '_proxy_'
const COMPONENT_WRAPPERS = new Set(['appRef', 'comRef', 'pageRef', 'popupRef'])

function isProxyMember(node: any, types: any): boolean {
  return !!node?.property &&
    ((types.isIdentifier(node.property, { name: PROXY_PROPERTY }) && !node.computed) ||
      (types.isStringLiteral(node.property, { value: PROXY_PROPERTY }) && node.computed))
}

export default function windowProxyPlugin({ types }: { types: any }) {
  return {
    visitor: {
      Program: {
        enter(program: any, state: any) {
          console.log('[windowProxyPlugin] scan', state.file?.opts?.filename || '<unknown>')
          const existingHookImport = program.get('body').find((path: any) =>
            path.isImportDeclaration() &&
            path.node.importKind !== 'type' &&
            path.node.source.value === 'mybricks'
          )?.node.specifiers.find((specifier: any) =>
            types.isImportSpecifier(specifier) &&
            (specifier.imported?.name || specifier.imported?.value) === 'useWindowProxy'
          )
          state.windowProxyHook = existingHookImport?.local ||
            program.scope.generateUidIdentifier('useWindowProxy')
          state.needsWindowProxyHook = false
        },
        exit(program: any, state: any) {
          if (!state.needsWindowProxyHook) {
            console.log('[windowProxyPlugin] no proxy component found')
            return
          }

          const mybricksImport = program.get('body').find((path: any) =>
            path.isImportDeclaration() &&
            path.node.importKind !== 'type' &&
            path.node.source.value === 'mybricks'
          )
          const hookSpecifier = types.importSpecifier(
            state.windowProxyHook,
            types.identifier('useWindowProxy'),
          )

          if (mybricksImport) {
            const alreadyImported = mybricksImport.node.specifiers.some((specifier: any) =>
              types.isImportSpecifier(specifier) &&
              (specifier.imported?.name || specifier.imported?.value) === 'useWindowProxy'
            )
            const hasNamespaceImport = mybricksImport.node.specifiers.some((specifier: any) =>
              types.isImportNamespaceSpecifier(specifier)
            )
            if (!alreadyImported && !hasNamespaceImport) {
              mybricksImport.node.specifiers.push(hookSpecifier)
            } else if (!alreadyImported) {
              program.unshiftContainer('body', types.importDeclaration(
                [hookSpecifier],
                types.stringLiteral('mybricks'),
              ))
            }
          } else {
            program.unshiftContainer('body', types.importDeclaration(
              [hookSpecifier],
              types.stringLiteral('mybricks'),
            ))
          }
          console.log('[windowProxyPlugin] imported useWindowProxy from mybricks')
        },
      },
      Function(functionPath: any, state: any) {
        const parentPath = functionPath.parentPath
        const variablePath = parentPath?.isVariableDeclarator()
          ? parentPath
          : parentPath?.isCallExpression() && parentPath.parentPath?.isVariableDeclarator()
            ? parentPath.parentPath
            : null
        const name = functionPath.node.id?.name || variablePath?.node.id?.name
        const wrapperName = parentPath?.isCallExpression() &&
          parentPath.node.callee?.type === 'Identifier'
          ? parentPath.node.callee.name
          : undefined
        const isWrappedComponent = !!wrapperName && COMPONENT_WRAPPERS.has(wrapperName)
        const isNamedComponent = !!name && /^[A-Z]/.test(name)
        if (!isWrappedComponent && !isNamedComponent) return

        let readsProxy = false
        const detectProxyMember = (member: any) => {
          if (isProxyMember(member.node, types)) readsProxy = true
        }
        functionPath.get('body').traverse({
          MemberExpression: detectProxyMember,
          OptionalMemberExpression: detectProxyMember,
        })
        console.log('[windowProxyPlugin] component check', {
          name: name || '<anonymous>',
          wrapper: wrapperName || null,
          readsProxy,
        })
        if (!readsProxy) return

        const subscribe = types.expressionStatement(
          types.callExpression(state.windowProxyHook, []),
        )
        const body = functionPath.get('body')
        if (body.isBlockStatement()) {
          body.unshiftContainer('body', subscribe)
        } else {
          body.replaceWith(types.blockStatement([
            subscribe,
            types.returnStatement(body.node),
          ]))
        }
        state.needsWindowProxyHook = true
        console.log('[windowProxyPlugin] injected useWindowProxy()', name || '<anonymous>')
      },
    },
  }
}

