/**
 * 为读取 window.__LINGSTYLE_DISPLAY_MOCK__ 的 React 组件注入 useWindowProxy Hook。
 *
 * windowProxyStore 负责维护代理对象和订阅状态；本插件只负责在编译期
 * 找到候选组件并添加 Hook 调用及对应的 import。
 *
 * 注入统一在 Program.enter 中完成：先主动遍历函数，再补齐 import，
 * 最后刷新作用域。这样后续 TypeScript、函数和 CommonJS 转换处理的
 * 就是包含完整 Hook 引用的 AST，避免编译结果残留未定义的本地标识符。
 */

const PROXY_PROPERTY = '__LINGSTYLE_DISPLAY_MOCK__'
const COMPONENT_WRAPPERS = new Set(['appRef', 'comRef', 'pageRef', 'popupRef'])

function isProxyMember(node: any, types: any): boolean {
  // 同时兼容 obj.__LINGSTYLE_DISPLAY_MOCK__ 和 obj['__LINGSTYLE_DISPLAY_MOCK__']。
  // 普通成员访问、可选链成员访问均可复用此判断。
  return !!node?.property &&
    ((types.isIdentifier(node.property, { name: PROXY_PROPERTY }) && !node.computed) ||
      (types.isStringLiteral(node.property, { value: PROXY_PROPERTY }) && node.computed))
}

export default function windowProxyPlugin({ types }: { types: any }) {
  // 原来顶层 Function visitor 的处理逻辑保留在这里，
  // 由 Program.enter 中的 program.traverse({ Function: injectHook }, state) 调用。
  function injectHook(functionPath: any, state: any) {
    const parentPath = functionPath.parentPath
    // 支持 const WorksPage = () => {} 和 const WorksPage = comRef(() => {})。
    // 函数声明的名称则直接从 functionPath.node.id 获取。
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
    // 保留原来的候选组件规则：指定包装函数的参数，或名称以大写字母开头的函数。
    if (!isWrappedComponent && !isNamedComponent) return

    // traverse 只遍历子节点，不检查起始节点本身。
    // 因此先检查函数体根节点，以覆盖 () => window.__LINGSTYLE_DISPLAY_MOCK__。
    let readsProxy = isProxyMember(functionPath.get('body').node, types)
    const detectProxyMember = (member: any) => {
      if (isProxyMember(member.node, types)) readsProxy = true
    }
    functionPath.get('body').traverse({
      MemberExpression: detectProxyMember,
      OptionalMemberExpression: detectProxyMember,
    })
    if (!readsProxy) return

    const subscribe = types.expressionStatement(
      // 每个引用必须使用独立的 AST 节点；CommonJS 转换会按节点去重，
      // 复用同一个 Identifier 会导致后续组件的调用未被改写。
      types.callExpression(types.cloneNode(state.windowProxyHook), []),
    )
    const body = functionPath.get('body')
    if (body.isBlockStatement()) {
      // 放在函数体开头，确保 Hook 在原有条件分支和提前 return 之前调用。
      body.unshiftContainer('body', subscribe)
    } else {
      // 表达式箭头函数改为代码块，并显式 return，保留原表达式的返回值。
      body.replaceWith(types.blockStatement([
        subscribe,
        types.returnStatement(body.node),
      ]))
    }
    state.needsWindowProxyHook = true
  }

  return {
    visitor: {
      Program: {
        enter(program: any, state: any) {
          // 优先复用已有 Hook 的本地名称，例如 useWindowProxy as subscribe。
          // 没有可复用的导入时，生成不与当前文件已有绑定冲突的名称。
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

          // Function 是 Babel 的函数节点别名，仍会匹配函数声明、函数表达式和箭头函数。
          // 将它从顶层 visitor 移到主动遍历中，是为了在后续函数转换前完成整份文件的注入。
          // 不再额外注册顶层 Function visitor，否则正常遍历时可能再次注入同一个 Hook。
          program.traverse({ Function: injectHook }, state)
          if (!state.needsWindowProxyHook) {
            return
          }

          const mybricksImport = program.get('body').find((path: any) =>
            path.isImportDeclaration() &&
            path.node.importKind !== 'type' &&
            path.node.source.value === 'mybricks'
          )
          const hookSpecifier = types.importSpecifier(
            types.cloneNode(state.windowProxyHook),
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
              // 普通具名导入可直接追加，已有 Hook 导入则无需重复添加。
              mybricksImport.node.specifiers.push(hookSpecifier)
            } else if (!alreadyImported) {
              // import * as mybricks 不能在同一声明中混用具名导入，需要另建声明。
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

          // 直接修改 AST 不会自动同步所有绑定和引用信息，需统一重新收集。
          // 后续 CommonJS 转换才能将每处本地调用改写为 mybricks 模块上的 Hook 调用。
          program.scope.crawl()
        },
      },
    },
  }
}

