import antd from './antd'
import antDesignIcons from './ant-design-icons'
import echarts from './echarts-for-react'
import dayjs from './dayjs'
import mybricks from './mybricks'
import createPublicValidator from './public/validator'
import context, { config } from '../context'

export type { ValidationError, LibraryValidator, LibraryMeta, LibraryResource, CodeValidationResult, ValidateContext } from './types'
export type EffectiveLibrary = { name: string; version: string; usage: string }

/**
 * 第一层：基础库，无论何时都需要加载。
 */
const BASE_LIBS: import('./types').LibraryMeta[] = [
  dayjs,
  mybricks,
]

/**
 * 第二层预设：当没有注入依赖时，使用的默认附加库。
 */
const PRESET_ADDON_LIBS: import('./types').LibraryMeta[] = [
  echarts,
  antd,
  antDesignIcons,
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
function getEffectiveValidators(ctx: import('./types').ValidateContext): import('./types').LibraryValidator[] {
  const { fileName } = ctx;
  const effectiveNames = getAllLibraryNames({ fileName })
  const addonNames = getAddonLibraryNames({ fileName })
  let addonValidators = config.getAddonValidators({ fileName })

  if (!addonValidators) {
    addonValidators = PRESET_ADDON_LIBS
      .filter((lib) => addonNames.includes(lib.name) && lib.validator)
      .map((lib) => lib.validator!) as import('./types').LibraryValidator[]
  }

  return [
    createPublicValidator(effectiveNames),
    ...BASE_LIBS.map((lib) => lib.validator).filter(Boolean) as import('./types').LibraryValidator[],
    ...addonValidators,
  ]
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
  const { fileName } = ctx;
  const plugins: Array<(babel: any) => { visitor: Record<string, any> }> = []

  for (const validator of getEffectiveValidators({ fileName })) {
    if (!validator.validatePlugin) continue
    try {
      plugins.push(validator.validatePlugin(ctx))
    } catch (e) {
      // console.warn(`[@getValidatorPlugins] ${validator.libraryName} 获取 plugin 异常:`, e)
    }
  }

  return plugins
}

// ── Library Doc ────────────────────────────────────────────────────────────────

function getLibraryUsage(library: { name: string; version: string; usage: string | (() => string); usagenext?: string }): string {
  // @ts-ignore [TODO] 临时usagenext
  const usage = library.name === 'mybricks' && window._sandbox_?.config?.componentRuntime?.entryFile === 'app.config.ts' ? library.usagenext : library.usage

  return typeof usage === 'function' ? usage() : (usage ?? '')
}

/**
 * 获取全部有效库的结构化文档（基础库 + 附加库），由 plugin 侧决定如何拼接提示词。
 */
export function getEffectiveLibraries(): EffectiveLibrary[] {
  const effectiveLibraries = config.getEffectiveLibraries()
  const addonLibs = effectiveLibraries.length > 0
    ? effectiveLibraries.map((lib) => toLibraryMeta(lib))
    : PRESET_ADDON_LIBS

  return [...BASE_LIBS, ...addonLibs].map((lib) => ({
    name: lib.name,
    version: lib.version ?? '',
    usage: getLibraryUsage(lib),
  }))
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


// ── 组件库信息 ────────────────────────────────────────────────────

/**
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
 * 获取有效的附加库名称列表（第二层）：
 */
export function getAddonLibraryNames({ fileName }): string[] {
  return config.getAddonLibraryNames({ fileName })
}

/**
 * 获取所有可用库的名称列表（基础库 + 附加库），去重。
 * 分层逻辑见 getAddonLibraryNames。
 */
export function getAllLibraryNames({ fileName }): string[] {
  const baseNames = BASE_LIBS.map((l) => l.name)
  const addonNames = getAddonLibraryNames({ fileName }).filter((n) => !baseNames.includes(n))
  return [...baseNames, ...addonNames]
}
