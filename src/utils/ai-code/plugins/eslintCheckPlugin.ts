/**
 * eslint 校验
 *  - eslintCheckPlugin babel编译阶段收集 ast 节点
 *  - runEslintCheck 调用 linter.verify，匹配 ast 节点抛出错误
 */

import eslint from '../../../mix/eslint'

export type EslintPathMap = Map<number, Map<string, any[]>>

export default function eslintCheckPlugin(pathMap: EslintPathMap) {
  return function ({ types: t }: { types: any }) {
    return {
      visitor: {
        Identifier(path: any) {
          const loc = path.node.loc?.start
          if (loc == null) return

          const { line } = loc
          const name: string = path.node.name
          if (!name) return

          if (!pathMap.has(line)) {
            pathMap.set(line, new Map())
          }
          const lineMap = pathMap.get(line)!
          // 同名同行按出现顺序全部收集
          if (!lineMap.has(name)) {
            lineMap.set(name, [path])
          } else {
            lineMap.get(name)!.push(path)
          }
        },
      },
    }
  }
}

export function runEslintCheck(
  jsCode: string,
  pathMap: EslintPathMap
) {
  const linter = eslint.getLinter()
  if (!linter || !jsCode) return

  const lintMessages = linter.verify(jsCode, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    env: {
      node: true,
      browser: true,
      es6: true,
    },
    globals: {
      // React 不默认导入
      React: 'readonly',
    },
    rules: {
      'no-undef': 'error',
    },
  })

  const errors: Error[] = lintMessages
    .filter((msg) => msg.severity === 2 && pathMap.has(msg.line))
    .map((msg) => {
      // ESLint message: "'varName' is not defined."
      // 提取变量名，用于在 pathMap 中按（行 + 变量名）定位原始 Babel path
      const varName = msg.message.match(/'([^']+)'/)?.[1]
      const lineMap = pathMap.get(msg.line)
      const paths = varName ? lineMap?.get(varName) : undefined
      // 同名多次出现时，按 ESLint 报错顺序依次消费（shift），使每条错误指向对应的节点
      const nodePath = paths?.shift()

      if (nodePath) {
        return nodePath.buildCodeFrameError(msg.message, SyntaxError)
      }
    })
    .filter((error) => {
      return !!error 
    })

  if (errors.length === 0) return

  const detail = errors.map((e) => e.message).join('\n\n')
  throw new SyntaxError(
    `[ESLint 校验] 发现 ${errors.length} 个错误：\n\n${detail}`
  )
}
