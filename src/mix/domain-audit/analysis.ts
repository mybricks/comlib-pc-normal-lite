export type DomainSourceFile = { path: string; content: string }

type SymbolInfo = { name: string; kind: string; line: number }
type Relation = { kind: string; name: string; line: number; source?: string }

/** Babel-only structural facts. Calls and JSX references are candidates, not resolved behavior. */
export function analyzeDomainSource(file: DomainSourceFile, symbol?: string) {
  const symbols: SymbolInfo[] = []
  const imports = new Map<string, string>()
  const relations: Relation[] = []
  let selected = false
  const diagnostics: string[] = []
  const babel = (window as any).Babel
  if (!babel) return { symbols, relations, imports, diagnostics: ['Babel is not ready; source analysis is unavailable.'] }

  const addSymbol = (name: string, kind: string, path: any, body: any) => {
    if (!name) return
    symbols.push({ name, kind, line: path.node.loc?.start?.line ?? 0 })
    if (!symbol || symbol !== name) return
    selected = true
    body.traverse({
      JSXOpeningElement(p: any) {
        const node = p.node.name
        const name = node.type === 'JSXIdentifier' ? node.name : node.type === 'JSXMemberExpression' && node.object.type === 'JSXIdentifier' && node.property.type === 'JSXIdentifier' ? `${node.object.name}.${node.property.name}` : ''
        if (!name || !/^[A-Z]/.test(name)) return
        relations.push({ kind: 'component', name, line: p.node.loc?.start?.line ?? 0, source: imports.get(name.split('.')[0]) })
      },
      CallExpression(p: any) {
        const callee = p.node.callee
        let name = ''
        if (callee.type === 'Identifier') name = callee.name
        else if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.property.type === 'Identifier') name = `${callee.object.name}.${callee.property.name}`
        if (name) relations.push({ kind: 'call', name, line: p.node.loc?.start?.line ?? 0, source: imports.get(name.split('.')[0]) })
      },
    })
  }
  try {
    babel.transform(file.content, {
      filename: file.path,
      code: false,
      ast: false,
      parserOpts: { sourceType: 'unambiguous', plugins: ['jsx', 'typescript', 'decorators-legacy'] },
      plugins: [() => ({ visitor: {
        Program(path: any) {
          for (const statement of path.get('body')) {
            if (!statement.isImportDeclaration()) continue
            for (const specifier of statement.node.specifiers) imports.set(specifier.local.name, statement.node.source.value)
          }
        },
        FunctionDeclaration(path: any) {
          if (!path.parentPath.isProgram() && !path.parentPath.isExportNamedDeclaration() && !path.parentPath.isExportDefaultDeclaration()) return
          addSymbol(path.node.id?.name || 'default', 'function', path, path)
        },
        ClassDeclaration(path: any) {
          if (!path.parentPath.isProgram() && !path.parentPath.isExportNamedDeclaration() && !path.parentPath.isExportDefaultDeclaration()) return
          addSymbol(path.node.id?.name || 'default', 'class', path, path)
        },
        VariableDeclarator(path: any) {
          const declaration = path.parentPath
          if (!declaration.parentPath.isProgram() && !declaration.parentPath.isExportNamedDeclaration()) return
          if (path.node.id.type !== 'Identifier') return
          addSymbol(path.node.id.name, 'variable', path, path)
        },
        ExportDefaultDeclaration(path: any) {
          const declaration = path.get('declaration')
          if (declaration.isFunctionDeclaration() || declaration.isClassDeclaration()) return
          addSymbol('default', 'default export', path, declaration)
        },
      } })],
    })
    if (symbol && !selected) diagnostics.push(`Symbol not found: ${symbol}. Inspect the file again.`)
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error))
  }
  return { symbols, relations, imports, diagnostics }
}
