import antd, { validator as antdValidator } from './antd'
import antDesignIcons, { validator as antDesignIconsValidator } from './ant-design-icons'
import echarts, { validator as echartsValidator } from './echarts-for-react'
import dayjs, { validator as dayjsValidator } from './dayjs'
import mybricks from './mybricks'
import publicValidator from './public/validator'

export type { ValidationError, LibraryValidator, CodeValidationResult, ValidateContext } from './types'

/**
 * 所有已注册的三方库校验器（mybricks 为内置库，无需校验，故不加入）
 * 新增库时在此追加
 */
const VALIDATORS = [
  publicValidator,
  antDesignIconsValidator,
  antdValidator,
  echartsValidator,
  dayjsValidator,
]

// ── 轻量字符串层 ──────────────────────────────────────────────────────────────

/**
 * 【轻量层】对 AI 生成的源代码进行三方库合法性校验（字符串/正则）。
 *
 * 在 Babel 编译之前运行，同步执行，适合快速拦截明显错误。
 * 精确的 AST 校验由 getValidatorPlugins() 在 transformTsx 中处理。
 *
 * @param code 源代码字符串
 * @param ctx  可选的文件上下文（fileName、relatedFiles）
 */
export function validateCode(
  code: string,
  ctx?: import('./types').ValidateContext
): import('./types').CodeValidationResult {
  const errors: import('./types').ValidationError[] = []

  for (const validator of VALIDATORS) {
    if (!validator.validate) continue
    try {
      const result = validator.validate(code, ctx)
      errors.push(...result)
    } catch (e) {
      console.warn(`[@validateCode] ${validator.libraryName} 字符串校验器异常:`, e)
    }
  }

  const ok = errors.length === 0
  const message = ok ? '' : formatValidationErrors(errors)
  return { ok, errors, message }
}

// ── AST 层 ────────────────────────────────────────────────────────────────────

/**
 * 【AST 层】收集所有实现了 validatePlugin 的校验器 Babel plugin，
 * 供 transformTsx 注入 plugins 数组，与 babelPlugin 共享同一次 parse/transform。
 *
 * @param ctx 文件上下文，含 fileName 和可选的 relatedFiles
 * @returns Babel plugin factory 数组，可直接展开到 plugins 配置中
 *
 * @example
 * // 在 transformTsx 中：
 * plugins: [
 *   ...existingPlugins,
 *   ...getValidatorPlugins({ fileName: 'runtime.jsx', relatedFiles })
 * ]
 */
export function getValidatorPlugins(
  ctx: import('./types').ValidateContext
): Array<(babel: any) => { visitor: Record<string, any> }> {
  const plugins: Array<(babel: any) => { visitor: Record<string, any> }> = []

  for (const validator of VALIDATORS) {
    if (!validator.validatePlugin) continue
    try {
      plugins.push(validator.validatePlugin(ctx))
    } catch (e) {
      console.warn(`[@getValidatorPlugins] ${validator.libraryName} 获取 plugin 异常:`, e)
    }
  }

  return plugins
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * 将错误列表格式化为可读字符串，与编译错误信息风格保持一致。
 */
function formatValidationErrors(errors: import('./types').ValidationError[]): string {
  const lines: string[] = ['[代码校验失败]']
  errors.forEach((err, i) => {
    lines.push(`${i + 1}. ${err.message}`)
    if (err.fix) {
      lines.push(`   修正建议：${err.fix}`)
    }
  })
  return lines.join('\n')
}


// ── Library Doc ────────────────────────────────────────────────────────────────

function getLibraryDocDescription(library: { version: string; usage: string }) {
  return `version: ${library.version}\n${library.usage}`
}

/**
 * 获取指定库的文档描述（用于注入 AI 提示词）。
 * mybricks 作为内置核心库，优先级最高，始终返回其文档。
 */
export function getLibraryDoc(libraryName: string): string {
  switch (libraryName) {
    case 'mybricks':
      return getLibraryDocDescription(mybricks)
    case 'antd':
      return getLibraryDocDescription(antd)
    case '@ant-design/icons':
      return getLibraryDocDescription(antDesignIcons)
    case 'echarts-for-react':
      return getLibraryDocDescription(echarts)
    case 'dayjs':
      return getLibraryDocDescription(dayjs)
    default:
      return ''
  }
}

/**
 * 获取所有库的文档描述，mybricks 优先排在最前面。
 */
export function getAllLibraryDocs(): string {
  return [
    getLibraryDocDescription(mybricks),
    getLibraryDocDescription(antd),
    getLibraryDocDescription(antDesignIcons),
    getLibraryDocDescription(echarts),
    getLibraryDocDescription(dayjs),
  ].join('\n\n')
}
