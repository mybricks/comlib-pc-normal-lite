/**
 * eslint 校验
 *  - eslintCheckPlugin 在 Babel 编译阶段内部执行校验
 *  - 校验对象为“仅剥离 TypeScript 类型后的产物”，避免完整编译产物导致行列偏移
 *  - 错误定位仍使用当前 Babel path.buildCodeFrameError，保证报错指向原始源码
 */

import eslint from '../../../mix/eslint'

type EslintPathMap = Map<number, Map<string, any[]>>

export default function eslintCheckPlugin(sourceCode: string, eslintConfig: any, onError?: (error: Error) => void) {
  return function () {
    const pathMap: EslintPathMap = new Map()

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
          // 同名同行按出现顺序全部收集，后续按照 ESLint 报错顺序依次消费
          if (!lineMap.has(name)) {
            lineMap.set(name, [path])
          } else {
            lineMap.get(name)!.push(path)
          }
        },
        Program: {
          exit() {
            const jsCode = transformTypeScriptOnly(sourceCode)
            runEslintCheck({
              jsCode,
              pathMap,
              onError,
              eslintConfig
            })
          },
        },
      },
    }
  }
}

function transformTypeScriptOnly(sourceCode: string): string {
  return window.Babel.transform(sourceCode, {
    plugins: [
      ['proposal-decorators', { legacy: true }],
      'proposal-class-properties',
      [
        'transform-typescript',
        {
          isTSX: true,
        },
      ],
    ],
    retainLines: true,
  }).code
}

export function runEslintCheck({
  jsCode,
  pathMap,
  onError,
  eslintConfig
}) {
  const linter = eslint.getLinter()
  if (!linter || !jsCode) return

  const lintMessages = linter.verify(jsCode, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: {
        jsx: true,
      },
    },
    env: {
      node: true,
      browser: true,
      es6: true,
    },
    globals: {
      // React 不默认导入
      React: 'readonly',
      ...eslintConfig?.globals
    },
    rules: {
      'no-undef': 'error',
    },
  })

  const errors: Error[] = lintMessages
    .filter((msg) => msg.severity === 2)
    .map((msg) => {
      // ESLint message: "'varName' is not defined."
      // 提取变量名，用于在 pathMap 中按（行 + 变量名）定位原始 Babel path
      const varName = msg.message.match(/'([^']+)'/)?.[1]
      const lineMap = pathMap.get(msg.line)
      const paths = varName ? lineMap?.get(varName) : undefined
      const nodePath = paths?.shift()

      if (nodePath) {
        return nodePath.buildCodeFrameError(msg.message, SyntaxError)
      }

      return new SyntaxError(`${msg.message} (${msg.line}:${msg.column})`)
    })
    .filter((error) => {
      return !!error
    })

  if (errors.length === 0) return

  const detail = errors.map((e) => e.message).join('\n\n')
  if (onError) {
    onError(new SyntaxError(
      `[ESLint 校验] 发现 ${errors.length} 个错误：\n\n${detail}`
    ))
    return
  }

  throw new SyntaxError(
    `[ESLint 校验] 发现 ${errors.length} 个错误：\n\n${detail}`
  )
}
