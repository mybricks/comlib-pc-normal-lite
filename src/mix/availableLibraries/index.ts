import antd from './antd'
import antDesignIcons from './ant-design-icons'
import echarts from './echarts-for-react'
import dayjs from './dayjs'
import antvG6 from './antv-g6'
import mybricks from './mybricks'
import createPublicValidator from './public/validator'
import context from '../context'

export type { ValidationError, LibraryValidator, LibraryMeta, LibraryResource, CodeValidationResult, ValidateContext } from './types'

/**
 * 第一层：基础库，无论何时都需要加载。
 */
const BASE_LIBS: import('./types').LibraryMeta[] = [
  dayjs,
  mybricks,
]

/**
 * 第二层预设：当 projectConfig.availableLibraries 未配置时使用的默认附加库。
 */
const PRESET_ADDON_LIBS: import('./types').LibraryMeta[] = [
  echarts,
  antd,
  antDesignIcons,
  antvG6,
]

/**
 * 所有内置库的注册表（基础库 + 预设附加库）。
 * 新增内置库时只需在此追加一条记录。
 */
const BUILTIN_LIBS: import('./types').LibraryMeta[] = [
  ...BASE_LIBS,
  ...PRESET_ADDON_LIBS,
]

/** 内置库名称列表，从注册表派生 */
export const BUILTIN_LIBRARY_NAMES = BUILTIN_LIBS.map((lib) => lib.name)

/**
 * 获取当前生效的校验器列表（延迟计算，每次调用时按分层逻辑动态构建）：
 * - publicValidator 使用当前生效的库名白名单
 * - 各库自带的 validator 仅包含基础库和当前生效的附加库
 */
function getEffectiveValidators(): import('./types').LibraryValidator[] {
  const effectiveNames = getAllLibraryNames()
  const addonNames = getAddonLibraryNames()
  // 生效的附加库（内置预设或项目配置）对应的 validator
  const projectLibs = context.projectConfig?.availableLibraries ?? []
  const isProjectConfigured = projectLibs.length > 0
  const addonValidators: import('./types').LibraryValidator[] = isProjectConfigured
    ? projectLibs
        .filter((lib) => lib.validator)
        .map((lib) => lib.validator!) as import('./types').LibraryValidator[]
    : PRESET_ADDON_LIBS
        .filter((lib) => addonNames.includes(lib.name) && lib.validator)
        .map((lib) => lib.validator!) as import('./types').LibraryValidator[]

  return [
    createPublicValidator(effectiveNames),
    ...BASE_LIBS.map((lib) => lib.validator).filter(Boolean) as import('./types').LibraryValidator[],
    ...addonValidators,
  ]
}

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

  for (const validator of getEffectiveValidators()) {
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

  for (const validator of getEffectiveValidators()) {
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

function getLibraryDocDescription(library: { name: string; version: string; usage: string }) {
  return `---\nname: ${library.name}\nversion: ${library.version}\n---\n${library.usage}`
}

/** 获取指定内置库的文档描述（用于注入 AI 提示词） */
export function getLibraryDoc(libraryName: string): string {
  const lib = BUILTIN_LIBS.find((l) => l.name === libraryName)
  return lib ? getLibraryDocDescription(lib) : ''
}

/** 获取所有内置库的文档描述拼接 */
export function getAllLibraryDocs(): string {
  return BUILTIN_LIBS.map((l) => getLibraryDocDescription(l)).join('\n\n')
}

/** 获取基础库（第一层）的文档描述拼接 */
export function getBaseLibraryDocs(): string {
  return BASE_LIBS.map((l) => getLibraryDocDescription(l)).join('\n\n')
}

/**
 * 获取有效的附加库文档（第二层）：
 * - 若 projectConfig.availableLibraries 有值，则返回其文档；
 * - 否则返回预设附加库（echarts-for-react、antd、@ant-design/icons、@antv/g6）的文档。
 */
export function getAddonLibraryDocs(): string {
  const projectLibs = context.projectConfig?.availableLibraries ?? []
  if (projectLibs.length > 0) {
    return projectLibs.map((lib) => getLibraryDocDescription(toLibraryMeta(lib))).join('\n\n')
  }
  return PRESET_ADDON_LIBS.map((l) => getLibraryDocDescription(l)).join('\n\n')
}

/**
 * 获取全部有效库文档（基础库 + 附加库），供 AI 提示词注入使用。
 * 分层逻辑见 getAddonLibraryDocs。
 */
export function getEffectiveLibraryDocs(): string {
  return [getBaseLibraryDocs(), getAddonLibraryDocs()].filter(Boolean).join('\n\n')
}

// ── 外部资源 ───────────────────────────────────────────────────────────────────

/**
 * 所有需要加载外部 UMD 资源的库列表（按库名索引），从注册表派生。
 */
const LIBRARY_RESOURCES_MAP: Map<string, import('./types').LibraryResource[]> = new Map(
  BUILTIN_LIBS
    .filter((lib) => lib.resources && lib.resources.length > 0)
    .map((lib) => [lib.name, lib.resources!])
)

/**
 * 获取指定库的外部资源列表。
 * 返回 undefined 表示该库无需加载外部资源（已打包到 bundle 中）。
 */
export function getLibraryResources(libraryName: string): import('./types').LibraryResource[] | undefined {
  return LIBRARY_RESOURCES_MAP.get(libraryName)
}

/**
 * 获取所有需要外部加载资源的库及其资源列表。
 */
export function getAllLibraryResources(): Array<{ name: string; resources: import('./types').LibraryResource[] }> {
  return Array.from(LIBRARY_RESOURCES_MAP.entries()).map(([name, resources]) => ({ name, resources }))
}


// ── projectConfig 组件库信息 ────────────────────────────────────────────────────

/**
 * 将 projectConfig.availableLibraries 中的单条记录转换为 LibraryMeta 格式。
 * readme → usage，其余字段对齐。
 */
function toLibraryMeta(lib: { name: string; version: string; readme: string; validator?: import('./types').LibraryValidator }): import('./types').LibraryMeta {
  return {
    name: lib.name,
    version: lib.version ?? '',
    usage: lib.readme ?? '',
    validator: lib.validator,
  }
}

/**
 * 获取 projectConfig.availableLibraries 中指定库的文档（转换为 LibraryMeta 后取 usage）。
 * 不触发 URL 加载。
 */
export function getProjectLibraryDoc(libraryName: string): string {
  const libs = context.projectConfig?.availableLibraries ?? []
  const lib = libs.find((l) => l.name === libraryName)
  if (!lib) return ''
  return getLibraryDocDescription(toLibraryMeta(lib))
}

/**
 * 获取 projectConfig.availableLibraries 中所有库的文档拼接（格式与内置库一致）。
 * 不触发 URL 加载。
 */
export function getAllProjectLibraryDocs(): string {
  const libs = context.projectConfig?.availableLibraries ?? []
  return libs.map((lib) => getLibraryDocDescription(toLibraryMeta(lib))).join('\n\n')
}

/**
 * 获取 projectConfig.availableLibraries 中所有库的名称列表。
 */
export function getProjectLibraryNames(): string[] {
  return (context.projectConfig?.availableLibraries ?? []).map((l) => l.name)
}

/**
 * 获取有效的附加库名称列表（第二层）：
 * - 若 projectConfig.availableLibraries 有值，则返回其名称；
 * - 否则返回预设附加库名称。
 */
export function getAddonLibraryNames(): string[] {
  const projectLibs = context.projectConfig?.availableLibraries ?? []
  if (projectLibs.length > 0) {
    return projectLibs.map((l) => l.name)
  }
  return PRESET_ADDON_LIBS.map((l) => l.name)
}

/**
 * 获取所有可用库的名称列表（基础库 + 附加库），去重。
 * 分层逻辑见 getAddonLibraryNames。
 */
export function getAllLibraryNames(): string[] {
  const baseNames = BASE_LIBS.map((l) => l.name)
  const addonNames = getAddonLibraryNames().filter((n) => !baseNames.includes(n))
  return [...baseNames, ...addonNames]
}
