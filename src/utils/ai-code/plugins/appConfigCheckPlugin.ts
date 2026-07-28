/**
 * app.config.ts 规范检测插件
 *
 * 当编译目标文件名为 app.config.ts 时，校验文件是否满足以下规范：
 *   - 必须使用 `defineAppConfig(...)` 作为默认导出（export default defineAppConfig(...)）
 *
 * 违反规范时通过 onError 上报带代码帧的 SyntaxError，提示开发者修正。
 *
 * 合法示例：
 *   export default defineAppConfig({ ... })
 *
 * 非法示例（会报错）：
 *   export default { ... }            // 未使用 defineAppConfig
 *   const cfg = defineAppConfig({})   // 未 export default
 */

export default function appConfigCheckPlugin(
  fileName: string,
  onError?: (error: Error) => void
) {
  return function ({ types: t }: { types: any }) {
    // 仅对 app.config.ts 生效
    const isAppConfig =
      fileName === 'app.config.ts' ||
      fileName?.endsWith('/app.config.ts') ||
      fileName?.endsWith('\\app.config.ts')

    if (!isAppConfig) {
      // 非目标文件，返回空 visitor
      return { visitor: {} }
    }

    let hasDefineAppConfigDefault = false

    return {
      visitor: {
        /**
         * 检查 `export default defineAppConfig(...)` 形式
         */
        ExportDefaultDeclaration(path: any) {
          const decl = path.node.declaration

          // export default defineAppConfig(...)
          if (
            t.isCallExpression(decl) &&
            t.isIdentifier(decl.callee, { name: 'defineAppConfig' })
          ) {
            hasDefineAppConfigDefault = true
            return
          }

          // export default (defineAppConfig(...))  带括号的情况
          if (
            t.isCallExpression(decl) &&
            t.isParenthesizedExpression?.(decl)
          ) {
            // 兼容 parenthesized 的情况，实际 AST 层 CallExpression 已是最外层
          }
        },
      },

      post(file: any) {
        if (hasDefineAppConfigDefault) return

        const error = new SyntaxError(
          [
            '[app.config.ts 规范校验] 未找到 defineAppConfig 的默认导出。',
            '',
            'app.config.ts 必须将 defineAppConfig 作为默认导出，例如：',
            '',
            '  export default defineAppConfig({',
            '    viewports: [...],',
            '    breakpoints: [...],',
            '  })',
            '',
            '说明：defineAppConfig 是全局注入的项目配置声明函数，直接使用即可，无需 import。',
          ].join('\n')
        )

        if (onError) {
          onError(error)
        } else {
          throw error
        }
      },
    }
  }
}
