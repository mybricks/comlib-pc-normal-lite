import context from '../../../../../mix/context'

/**
 * Babel 插件：Skill 封闭单元边界校验
 *
 * 在 gui_card 模式下，每个 skill 是一个封闭的独立单元。
 * 该插件禁止 skill 内部的文件通过相对路径 import 引用 skill 目录之外的文件。
 *
 * 判断规则：
 * - 只检查相对路径 import（以 `.` 开头）
 * - 绝对路径 / 三方包 import 不受限制
 * - 如果 import 解析后的路径不在 skillRoot 目录下，则报错
 *
 * 示例（skillRoot = '/skills/my-skill/'）：
 *   ✅ import './utils'              → /skills/my-skill/utils  （在边界内）
 *   ✅ import './sub/helper'        → /skills/my-skill/sub/helper （在边界内）
 *   ✅ import 'antd'                → 三方包，不受限
 *   ❌ import '../shared/utils'     → /skills/shared/utils  （越界！）
 *   ❌ import '../../global'        → /global  （越界！）
 */

/**
 * 将路径中的 `.` / `..` 规范化（简单版，不依赖 Node.js path 模块）
 * 输入：/skills/my-skill/sub/../index
 * 输出：/skills/my-skill/index
 */
function normalizePath(p: string): string {
  const parts = p.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') {
      if (stack.length === 0) stack.push('') // 保留根 /
      continue
    }
    if (part === '..') {
      if (stack.length > 1 || (stack.length === 1 && stack[0] !== '')) {
        stack.pop()
      }
    } else {
      stack.push(part)
    }
  }
  return stack.join('/')
}

/**
 * 解析 import source 的绝对路径
 * @param source    import 的相对路径，如 '../utils'
 * @param fileDir   当前文件所在目录（绝对路径，末尾不含斜杠），如 '/skills/my-skill/sub'
 */
function resolveImportPath(source: string, fileDir: string): string {
  return normalizePath(`${fileDir}/${source}`)
}

/**
 * 获取文件所在目录（不含文件名，末尾不含斜杠）
 */
function getFileDir(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  return lastSlash === -1 ? '' : filePath.slice(0, lastSlash)
}

/**
 * 在 gui_card 模式下，找出 fileName 所在的 skill 根目录。
 * 约定：skill 根目录是包含 SKILL.md 的那个目录。
 * 例如：fileName = 'skills/my-skill/index.tsx'
 *       files 中存在 'skills/my-skill/SKILL.md'
 *       → 返回 'skills/my-skill'（不含末尾斜杠）
 * 若找不到，返回 null。
 */
function findSkillRoot(fileName: string, files: Array<{ fileName: string }>): string | null {
  const fileNamesSet = new Set(files.map((f) => f.fileName))
  const parts = fileName.split('/')
  // 从文件所在目录逐级向上查找 SKILL.md
  for (let i = parts.length - 1; i >= 1; i--) {
    const dir = parts.slice(0, i).join('/')
    const skillMdPath = `${dir}/SKILL.md`
    if (fileNamesSet.has(skillMdPath)) {
      return dir
    }
  }
  return null
}

export default function skillBoundaryPlugin({ fileName }: { fileName: string;}) {
  return function (_babel: any) {
    const skillRoot = findSkillRoot(fileName, context.component!.params.data.files)
    if (!skillRoot) {
      return {}
    }
    const errors: Error[] = []
    const fileDir = getFileDir(fileName)

    // skillRoot 末尾统一去掉斜杠，便于 startsWith 比较
    const normalizedSkillRoot = skillRoot.endsWith('/') ? skillRoot.slice(0, -1) : skillRoot

    return {
      visitor: {
        ImportDeclaration(path: any) {
          try {
            const source: string = path.node.source.value

            // 只校验相对路径 import（以 . 开头）
            if (!source.startsWith('.')) return

            const resolvedPath = resolveImportPath(source, fileDir)

            // 检查解析后路径是否在 skillRoot 范围内
            const insideSkill =
              resolvedPath === normalizedSkillRoot ||
              resolvedPath.startsWith(normalizedSkillRoot + '/')

            if (!insideSkill) {
              errors.push(
                path.buildCodeFrameError(
                  `[Skill 边界校验] 禁止跨 skill 引用外部文件。\n` +
                  `  当前文件：${fileName}\n` +
                  `  非法 import：${source}\n` +
                  `  解析路径：${resolvedPath}\n` +
                  `  Skill 根目录：${normalizedSkillRoot}\n` +
                  `  Skill 是一个封闭单元，只能 import skill 目录内的文件，不允许引用 skill 外部的路径。`,
                  SyntaxError
                )
              )
            }
          } catch (e: any) {
            // buildCodeFrameError 成功时会 push 到 errors，此处只处理意外异常
            if (errors.length === 0 || errors[errors.length - 1] !== e) {
              errors.push(e)
            }
          }
        },
      },

      post() {
        if (errors.length === 0) return
        const detail = errors.map((e) => e.message).join('\n\n')
        throw new SyntaxError(
          `[Skill 边界校验] 发现 ${errors.length} 个跨边界 import：\n\n${detail}`
        )
      },
    }
  }
}
