import { ReactElement, createElement } from 'react'
import { Events } from '../events'
import ErrorBoundary from '../HotComponent/ErrorBoundary'
import createHotComponent from '../HotComponent'
import { hackProxy } from '../hackProxy'
import { FileWatcher } from './watcher'
import { extractMissingFiles } from '..'
import type {
  Files,
  Dependencies,
  Css,
  Vibing,
  ErrorView,
  LoadingView,
  Definitions,
  OnRuntimeError
} from '../../types'
import { DYNAMIC_MODULE } from '../../../../../../mix/context/config'

interface LoadModuleParams {
  filename: string
  compiled: string
  dependencies: Dependencies
  definitions: Definitions
  ErrorView: ErrorView
  onRuntimeError: OnRuntimeError
}
interface ModuleExports {
  default: any
  __default: any
  [key: string]: any
}
const loadModule = (params: LoadModuleParams): ModuleExports => {
  const {
    filename,
    compiled,
    definitions,
    dependencies,
    ErrorView
  } = params

  const exports: any = {
    default: null,
    __default: null
  }

  const { _refreshPopups } = dependencies['mybricks']
  _refreshPopups?.(filename)

  try {
    eval(`(function(exports, require) {
      ${Object.entries(definitions).reduce((pre, [key, value]) => {
        return pre.replaceAll(key, value)
      }, compiled)}
      //# sourceURL=_mybricks_ai/${filename}
    })`)(exports, (packageName: string) => {
    const result = dependencies[packageName]
    if (packageName === 'mybricks') {
      return {
        ...result,
        popupRef: (Component, params = {}) => {
          return result.popupRef(Component, {
            filename,
            ...params,
            ErrorView: ({ children }) => {
              return createElement(ErrorBoundary, {
                onError() {

                },
                resetKey: 1,
                ErrorView,
                // @ts-ignore 引擎特殊处理逻辑
                _onError_() {}
              }, children)
            }
          })
        },
        comRef: (Component, params = {}) => {
          return result.comRef(Component, { filename, ...params })
        },
        DataSource: class DataSource extends result.DataSource {
          constructor() {
            super({ id: filename })
          }
        }
      }
    }

    if (result[DYNAMIC_MODULE]) {
      return result({ id: filename, logger: dependencies.mybricks.logger })
    }

    return result
  })
  } catch (e: any) {
    // console.log('[params]', params)
    // [TODO] 复制的代码，关注下错误信息收集是否准确
    // 构造带有文件位置信息的运行时错误
    const fileLabel = filename ? `[${filename}] ` : ''
    const originalMessage = e?.message || String(e)

    // 尝试从错误堆栈中提取行号（eval 内部行号，偏移 2 行的包装代码头）
    let lineInfo = ''
    const stackMatch = e?.stack?.match(/<anonymous>:(\d+):(\d+)/)
    if (stackMatch) {
      const evalLine = parseInt(stackMatch[1], 10)
      // wrapCode 包装头占 2 行，所以实际代码行 = evalLine - 2
      const codeLine = Math.max(1, evalLine - 2)
      lineInfo = ` (第 ${codeLine} 行)`
    }

    const enrichedError: any = new Error(`${fileLabel}${originalMessage}${lineInfo}`)
    enrichedError.originalError = e
    enrichedError.fileName = filename
    // throw enrichedError
    params.onRuntimeError(enrichedError)
  }

  return exports
}

const JSX_MODULE_EXTENSIONS = ['.jsx', '.tsx'] as const
const JS_MODULE_EXTENSIONS = ['.js', '.ts'] as const
const RESOLVE_EXTENSIONS = [...JSX_MODULE_EXTENSIONS, ...JS_MODULE_EXTENSIONS] as const

const isJsModule = (filename: string): boolean => {
  return JS_MODULE_EXTENSIONS.some(ext => filename.endsWith(ext))
}

const isJsxModule = (filename: string): boolean => {
  return JSX_MODULE_EXTENSIONS.some(ext => filename.endsWith(ext))
}

interface LoadCssParams {
  file: Files[0]
  css: Css
  dependencies: Dependencies
}
const loadCssModule = (params: LoadCssParams) => {
  const { file, css, dependencies } = params;
  const compiled = decodeURIComponent(file.compiled)
  const cssModule = JSON.parse(compiled);
  const { cssContent, classMap, imports } = cssModule;
  const importModules: any = []
  if (imports) {
    imports.forEach((path) => {
      importModules.unshift(dependencies[path])
    })
  }
  const proxy = new Proxy({}, {
    get(_, key) {
      if (key === 'default') {
        return proxy
      }
      return importModules.reduce((pre, cur) => {
        return cur?.classMap?.[key] || pre
      }, classMap[key] || key)
    }
  })

  const module = {
    default: proxy,
    classMap
  }
  Object.defineProperty(module, '__esModule', {
    value: true
  })

  css.set(file.filename, cssContent)

  return { module }
}

const CSS_MODULE_EXTENSIONS = ['.less'] as const

const isCssModule = (filename: string): boolean => {
  return CSS_MODULE_EXTENSIONS.some(ext => filename.endsWith(ext))
}

const isMdModule = (filename: string): boolean => {
  return filename.endsWith('.md')
}

const resolveFilename = (filename: string, filesMap: FilesMap, tempFilesMap: FilesMap) => {
  let entry = filesMap[filename] || tempFilesMap[filename]
  let resolvedFilename = filename

  // 如果找不到,尝试添加后缀查找
  if (!entry) {
    for (const ext of RESOLVE_EXTENSIONS) {
      resolvedFilename = filename + ext
      const entry1 = filesMap[resolvedFilename] || tempFilesMap[resolvedFilename]
      if (entry1) {
        entry = entry1
        break
      }
      resolvedFilename = filename + '/index' + ext
      const entry2 = filesMap[resolvedFilename] || tempFilesMap[resolvedFilename]
      if (entry2) {
        entry = entry2
        break
      }
    }
  }

  return entry
}

// 对比匹配文件
export const matchfile = (filename, entryfilename) => {
  if (filename === entryfilename) {
    return true
  }

  return RESOLVE_EXTENSIONS.find((ext) => {
    if (filename + ext === entryfilename) {
      return true
    }
    if (filename + '/index' + ext === entryfilename) {
      return true
    }
    return false
  })
}

interface FileSystemParams {
  dependencies: Dependencies
  css: Css
  // [TEMP] 约定入口文件一定是JSX
  entryFile: string;

  LoadingView: LoadingView
  ErrorView: ErrorView
  onRuntimeError: OnRuntimeError
  definitions: Definitions
}

/** 命名导出组件的热更新子条目 */
interface NamedExportEntry {
  /** 所有挂载实例的 forcer 集合 */
  forceUpdateSet: Set<() => void>
  /** 当前组件实现 */
  currentImpl: (props: unknown) => ReactElement | null
  /** 错误信息 */
  errors: {
    runtime: Error | null
  }
}

type FilesMap = Record<string, {
  file: Files[0]
  module: {
    default: any
    [key: string | symbol]: any
  }
  /** 该文件依赖的文件列表 */
  dependencies: Set<string>
  /** 依赖该文件的文件列表 */
  dependedBy: Set<string>
  /** 所有挂载实例的 forcer 集合 */
  forceUpdateSet: Set<() => void>
  /** 渲染组件 */
  currentImpl: (props: unknown) => ReactElement | null
  /** 清理临时文件 */
  clearTempFiles?: (filename: string) => void
  /** 是否入口文件 */
  isEntry?: boolean
  /** 错误信息 */
  errors: {
    /** 运行时错误 */
    runtime: Error | null
  }
  /** 命名导出组件的热更新子条目，key 为导出名 */
  namedEntries?: Record<string, NamedExportEntry>
  /** 命名导出中非函数类型（变量、对象等）的 key 集合，用于检测删除 */
  namedVariableKeys?: Set<string>
}>

class FileSystem {
  /** 参数 */
  params: FileSystemParams

  /** 文件名映射到文件信息 */
  filesMap: FilesMap = {}

  /** 事件 */
  events = new Events<{
    init: boolean
    fileChange: { filename: string, type: 'update' | 'delete' | 'create' }
  }>({})

  /** vibing状态 */
  vibing: Vibing = false

  /** 临时文件存储 */
  tempFilesMap: FilesMap = {}

  /** 临时依赖存储，使用了未注入的依赖。key 为文件名，value 为该文件引用但未注入的包名集合 */
  tempDependencies = new Map<string, Set<string>>()

  /** 全局错误监听器引用 */
  private _onError: ((event: ErrorEvent) => void) | null = null

  fileWatcher: FileWatcher = new FileWatcher(this)

  error: Error | null = null

  constructor(params: FileSystemParams) {
    this.params = params
  }

  /** 注册错误监听 */
  setupErrorListeners() {
    // 避免重复注册
    if (this._onError) return

    const isFromSandbox = (stack: string) => {
       const knownFiles = [
        ...Object.keys(this.filesMap),
        ...Object.keys(this.tempFilesMap)
      ]

      for (const filename of knownFiles) {
        if (stack.includes(`_mybricks_ai/${filename}`)) {
          return stack.replace(`_mybricks_ai/${filename}`, filename)
        }
      }
    }

    this._onError = (event: ErrorEvent) => {
      const { error } = event
      if (!error?.stack) return
      const replaceStack = isFromSandbox(error.stack)
      if (replaceStack) {
        error.stack = replaceStack
        this.params.onRuntimeError(error, error)
      }
    }

    window.addEventListener('error', this._onError)
  }

  /** 卸载错误监听 */
  teardownErrorListeners() {
    if (this._onError) {
      window.removeEventListener('error', this._onError)
      this._onError = null
    }
  }

  /** 初始化 */
  init(files: Files) {
    let sorted = files;

    try {
      function extractDeps(compiled: string, currentFile: string): string[] {
        const deps: string[] = []
        // 匹配以下几种形式：
        // require("./xxx")
        // import("./xxx")
        // import xxx from "./xxx"
        // import { xxx } from "./xxx"
        // import "./xxx"
        const requireOrDynamicImport = /(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g
        const staticImport = /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g
        let match
        while ((match = requireOrDynamicImport.exec(compiled)) !== null) {
          if (match[1].startsWith('.')) deps.push(match[1])
        }
        while ((match = staticImport.exec(compiled)) !== null) {
          if (match[1].startsWith('.')) deps.push(match[1])
        }
        return deps
      }
      function topoSort(files: Files): Files {
        const visited = new Set<string>()
        const result: Files = []
        const fileMap = Object.fromEntries(files.map(f => [f.filename, f]))

        const visit = (file: Files[0]) => {
          if (visited.has(file.filename)) return
          visited.add(file.filename)
          // 先处理依赖
          const deps = extractDeps(decodeURIComponent(file.compiled), file.filename)
          for (const dep of deps) {
            // 将相对路径解析为真实文件名
            let currentPath = file.filename.split('/')
            currentPath = currentPath.slice(0, currentPath.length - 1)
            dep.split('/').forEach((seg) => {
              if (seg === '..') currentPath.pop()
              else if (seg !== '.') currentPath.push(seg)
            })
            const resolvedPath = currentPath.join('/')
            // 尝试精确匹配或加后缀匹配
            const resolvedFile = fileMap[resolvedPath] ?? RESOLVE_EXTENSIONS.reduce<Files[0] | undefined>((found, ext) => {
              return found ?? fileMap[resolvedPath + ext] ?? fileMap[resolvedPath + '/index' + ext]
            }, undefined)
            if (resolvedFile) visit(resolvedFile)
          }
          result.push(file)
        }

        files.forEach(visit)
        return result
      }
      sorted = topoSort(files)
      // 把所有 .config.ts 文件提前到最前面
      sorted.sort((a, b) => {
        const aIsConfig = a.filename.endsWith('.config.ts')
        const bIsConfig = b.filename.endsWith('.config.ts')
        if (aIsConfig && !bIsConfig) return -1
        if (!aIsConfig && bIsConfig) return 1
        return 0
      })
    } catch {}

    sorted.forEach(file => {
      this.update(file.filename, file)
    })
  }

  /**
   * filename 加载目标
   * from 被谁加载（filename）
   */
  get(filename: string, options: { from?: string, isEntry?: boolean}) {
    const entry = resolveFilename(filename, this.filesMap, this.tempFilesMap)
    const { from, isEntry } = options

    if (!entry) {
      const module: any = {
        default: hackProxy(),
        __default: null
      }

      Object.defineProperty(module, '__esModule', {
        value: true
      })
      module.__default = module.default

      const tempEntry = {
        file: {
          filename: '临时文件',
          compiled: '',
          source: '',
          jsDocMap: ''
        },
        module,
        dependencies: new Set<string>(),
        dependedBy: new Set<string>(),
        forceUpdateSet: new Set<() => void>(),
        currentImpl: module.__default || (() => null),
        clearTempFiles: (realFilename) => {
          RESOLVE_EXTENSIONS.forEach((ext) => {
            if (from) {
              const fromEntry = this.filesMap[from]
              fromEntry.dependencies.delete(filename)
              fromEntry.dependencies.delete(`${filename}${ext}`)
              fromEntry.dependencies.delete(`${filename}/index${ext}`)
              fromEntry.dependencies.add(realFilename)
            }
            Reflect.deleteProperty(this.tempFilesMap, filename)
            Reflect.deleteProperty(this.tempFilesMap, `${filename}${ext}`)
            Reflect.deleteProperty(this.tempFilesMap, `${filename}/index${ext}`)
          })
        },
        isEntry,
        errors: {
          runtime: null
        }
      }

      const HotComponent = this.createHotComponent({ entry: tempEntry })
      module.default = HotComponent

      if (from) {
        // 记录临时依赖关系，等待真实文件来刷新
        const fromEntry = this.filesMap[from]
        tempEntry.dependedBy.add(from)

        fromEntry.dependencies.add(filename)
        this.tempFilesMap[filename] = tempEntry

        RESOLVE_EXTENSIONS.forEach((ext) => {
          fromEntry.dependencies.add(`${filename}${ext}`)
          fromEntry.dependencies.add(`${filename}/index${ext}`)
          // 临时entry，file为null
          this.tempFilesMap[`${filename}${ext}`] = tempEntry
          this.tempFilesMap[`${filename}/index${ext}`] = tempEntry
        })
      }

      return tempEntry.module
    }

    if (entry.module) {
      if (from) {
        const fromEntry = this.filesMap[from]
        // 有来源，记录依赖关系
        // from 依赖 entry
        fromEntry.dependencies.add(entry.file.filename)
        // entry 被 from 依赖
        entry.dependedBy.add(from)
      }
      return entry.module
    }

    const resolvedFilename = entry.file.filename

    if (isJsxModule(resolvedFilename) || matchfile(resolvedFilename, this.params.entryFile)) {
      const module = this.loadModule({
        filename: resolvedFilename,
        compiled: decodeURIComponent(entry.file.compiled),
        dependencies: this.proxyDependencies(resolvedFilename),
        onRuntimeError: (error: Error) => {
          entry.errors.runtime = error
          this.params.onRuntimeError(error, entry.file)
        }
      })

      module.__default = module.default
      // 将实际的组件函数赋值给 currentImpl
      entry.currentImpl = module.__default || (() => null)
      const HotComponent = this.createHotComponent({ entry })
      module.default = HotComponent
      entry.module = module
    } else if (isJsModule(resolvedFilename)) {
      const module = this.loadModule({
        filename: resolvedFilename,
        compiled: decodeURIComponent(entry.file.compiled),
        dependencies: this.proxyDependencies(resolvedFilename),
        onRuntimeError: (error: Error) => {
          entry.errors.runtime = error
          this.params.onRuntimeError(error, entry.file)
        }
      })

      entry.module = module
    } else if (isCssModule(resolvedFilename)) {
      const { module } = loadCssModule({ file: entry.file, css: this.params.css, dependencies: this.proxyDependencies(filename), })

      entry.module = module
    }

    if (from) {
      const fromEntry = this.filesMap[from]
      // 有来源，记录依赖关系
      // from 依赖 entry
      fromEntry.dependencies.add(resolvedFilename)
      // entry 被 from 依赖
      entry.dependedBy.add(from)
    }

    return entry.module
  }

  delete(filename: string) {
    filename = filename.replace(/^\//, '')
    // 删除文件
    const entry = this.filesMap[filename]

    if (!entry) {
      return
    }
    
    // 清理正向依赖: 从"依赖该文件的文件"中移除对该文件的引用
    entry.dependedBy.forEach((dependentFilename) => {
      const dependentEntry = this.filesMap[dependentFilename]
      if (dependentEntry) {
        // 从依赖者的 dependencies 中删除当前文件
        dependentEntry.dependencies.delete(filename)
      }
    })
    
    // 清理反向依赖: 从"该文件依赖的文件"中移除该文件的引用
    entry.dependencies.forEach((dependencyFilename) => {
      const dependencyEntry = this.filesMap[dependencyFilename]
      if (dependencyEntry) {
        // 从被依赖文件的 dependedBy 中删除当前文件
        dependencyEntry.dependedBy.delete(filename)
      }
    })

    Reflect.deleteProperty(this.filesMap, filename)
    // 清理该文件的临时依赖记录
    this.tempDependencies.delete(filename)

    this.events.emit('fileChange', { filename, type: 'delete' })

    this.fileWatcher.emit(filename, 'delete')
    this.fileWatcher.clearFile(filename)
  }

  update(filename: string, file: Files[0]) {
    filename = filename.replace(/^\//, '')
    file.filename = filename
    // [TODO] 考虑编译报错的情况
    let entry = this.filesMap[filename]

    if (!entry) {
      entry = this.tempFilesMap[filename]

      if (entry) {
        this.filesMap[filename] = entry
        if (entry.clearTempFiles) {
          // 清空临时文件和依赖
          entry.clearTempFiles(filename)
          Reflect.deleteProperty(entry, 'clearTempFiles')
        }
      }
    }

    // 文件已存在时，清理旧的正向依赖关系，避免修复路径后 tempFilesMap 残留
    if (entry) {
      this.cleanupStaleDependencies(filename, entry)
      // 清除错误信息
      entry.errors = {
        runtime: null
      }
    }

    // update用于新增和修改
    if (isJsxModule(filename) || matchfile(filename, this.params.entryFile)) {
      if (entry) {
        const module = this.loadModule({
          filename,
          compiled: decodeURIComponent(file.compiled),
          dependencies: this.proxyDependencies(filename),
          onRuntimeError: (error: Error) => {
            entry.errors.runtime = error
            this.params.onRuntimeError(error, entry.file)
          }
        })
        entry.file = file
        entry.module!.__default = module.default
        // default 导出被删除时，渲染一个会抛出错误的组件，让 ErrorBoundary 展示错误
        entry.currentImpl = module.default
          ? module.default
          : () => { throw new Error(`[${filename}] 默认导出（export default）已被删除或为空`) }
        entry.forceUpdateSet.forEach(fn => fn())
        // 更新命名导出，并触发命名导出中组件的热更新
        this.syncNamedExports(entry, module, filename)
        // 触发依赖该文件的上游模块重新渲染（处理导入该文件变量的情况）
        this.refreshDependents(filename)
      } else {
        const tempModule: any = {
          default: hackProxy(),
          __default: null
        }
        Object.defineProperty(tempModule, '__esModule', {
          value: true
        })
        tempModule.__default = tempModule.default

        const tempEntry = {
          file,
          module: tempModule,
          dependencies: new Set<string>(),
          dependedBy: new Set<string>(),
          forceUpdateSet: new Set<() => void>(),
          currentImpl: () => null,
          errors: {
            runtime: null
          }
        }
        const HotComponent = this.createHotComponent({ entry: tempEntry })
        tempModule.default = HotComponent
        this.filesMap[filename] = tempEntry
        const module = this.loadModule({
          filename,
          compiled: decodeURIComponent(file.compiled),
          dependencies: this.proxyDependencies(filename),
          onRuntimeError: (error: Error) => {
            // @ts-ignore
            tempEntry.errors.runtime = error
            this.params.onRuntimeError(error, tempEntry.file)
          }
        })
        // 初始化命名导出（包括组件热更新包装）
        this.syncNamedExports(tempEntry, module, filename)
        tempEntry.module!.__default = module.default
        // default 导出为空时同样报错
        tempEntry.currentImpl = module.default
          ? module.default
          : () => { throw new Error(`[${filename}] 默认导出（export default）已被删除或为空`) }
      }
    } else if (isJsModule(filename)) {
      if (entry) {
        const module = this.loadModule({
          filename,
          compiled: decodeURIComponent(file.compiled),
          dependencies: this.proxyDependencies(filename),
          onRuntimeError: (error: Error) => {
            entry.errors.runtime = error
            this.params.onRuntimeError(error, entry.file)
          }
        })
        entry.file = file
        entry.module = module
      } else {
        const tempModule = {
          default: () => null
        }
        Object.defineProperty(tempModule, '__esModule', {
          value: true
        })
        this.filesMap[filename] = {
          file,
          module: tempModule,
          dependencies: new Set(),
          dependedBy: new Set(),
          forceUpdateSet: new Set<() => void>(),
          currentImpl: () => null,
          errors: {
            runtime: null
          }
        }
        const module = this.loadModule({
          filename,
          compiled: decodeURIComponent(file.compiled),
          dependencies: this.proxyDependencies(filename),
          onRuntimeError: (error: Error) => {
            this.filesMap[filename].errors.runtime = error
            this.params.onRuntimeError(error, this.filesMap[filename].file)
          }
        })
        this.filesMap[filename].module = module
      }

      this.refreshDependents(filename)
    } else if (isCssModule(filename)) {
      // 如果是less文件，解析后再次调用css即可
      // [TODO] 目前不存在引用关系
      let refresh = false

      if (entry) {
        const { module } = loadCssModule({ file, css: this.params.css, dependencies: this.proxyDependencies(filename), })
        if (!entry.module.classMap || (Object.keys(entry.module.classMap).join('') !== Object.keys(module.classMap).join(''))) {
          refresh = true
        }
        // if (!entry.module.classMap) {
        //   refresh = true
        // }
        entry.file = file
        entry.module = module
      } else {
        const proxy = new Proxy({}, {
        get(_, key) {
          if (key === 'default') {
            return proxy
          }
          return key
        }
      })

      const tempModule = {
        default: proxy,
        classMap: {}
      }
        this.filesMap[filename] = {
          file,
          module: tempModule,
          dependencies: new Set(),
          dependedBy: new Set(),
          forceUpdateSet: new Set<() => void>(),
          currentImpl: () => null,
          errors: {
            runtime: null
          }
        }
        const { module } = loadCssModule({ file, css: this.params.css, dependencies: this.proxyDependencies(filename), })
        this.filesMap[filename].module = module
        refresh = true
      }

      if (refresh) {
        this.refreshDependents(filename)
      }
    } else if (isMdModule(filename)) {
      if (entry) {
        entry.file = file
        entry.module = {
          default: decodeURIComponent(file.source)
        }
      } else {
        const tempModule = {
          default: decodeURIComponent(file.source)
        }
        Object.defineProperty(tempModule, '__esModule', {
          value: true
        })
        this.filesMap[filename] = {
          file,
          module: tempModule,
          dependencies: new Set(),
          dependedBy: new Set(),
          forceUpdateSet: new Set<() => void>(),
          currentImpl: () => null,
          errors: {
            runtime: null
          }
        }
      }
    }

    this.events.emit('fileChange', { filename, type: entry ? 'update' : 'create'})
    this.fileWatcher.emit(filename, entry ? 'update' : 'create')
  }

  /** 依赖代理，读取相对路径引用 */
  proxyDependencies(filename: string) {
    const that = this;
    return new Proxy(this.params.dependencies, {
      get(target, key: string) {
        if (key in target) {
          return target[key];
        }

        // 判断是依赖还是相对路径，依赖直接抛出错误
        if (!key.startsWith('.')) {
          let fileDeps = that.tempDependencies.get(filename)
          if (!fileDeps) {
            fileDeps = new Set()
            that.tempDependencies.set(filename, fileDeps)
          }
          fileDeps.add(key)
          return {
            default: hackProxy(),
            __default: null
          }
        }

        let currentPath = filename.split('/');
        currentPath = currentPath.slice(0, currentPath.length - 1)
        const targetPath = key.split('/');

        targetPath.forEach((path) => {
          if (path === ".") {
          } else if (path === "..") {
            currentPath.pop();
          } else {
            currentPath.push(path)
          }
        })

        return that.get(currentPath.join('/'), { from: filename })
      }
    })
  }

  /**
   * 清理文件更新前的旧正向依赖关系，移除不再引用的 tempFilesMap 条目
   *
   * 场景：文件 A 导入了错误路径 ../../foo，tempFilesMap 记录了对应的缺失条目；
   * 修复为正确路径 ../../../foo 后，旧条目需要被清理，否则 extractMissingFiles
   * 仍会报出已不存在的"缺失文件"。
   */
  private cleanupStaleDependencies(filename: string, fileEntry: FilesMap[string]) {
    const potentiallyOrphanedTempEntries = new Set<FilesMap[string]>()

    // 从所有旧正向依赖的 dependedBy 中移除当前文件
    fileEntry.dependencies.forEach((depFilename) => {
      const depEntry = this.filesMap[depFilename] || this.tempFilesMap[depFilename]
      if (depEntry) {
        depEntry.dependedBy.delete(filename)
        if (this.tempFilesMap[depFilename]) {
          potentiallyOrphanedTempEntries.add(depEntry)
        }
      }
    })

    // 清空正向依赖，后续 loadModule 会重建
    fileEntry.dependencies.clear()

    // 清空该文件的临时依赖记录，后续 loadModule 会重建
    this.tempDependencies.delete(filename)

    // 删除已无依赖者的 tempFilesMap 条目（同一 tempEntry 可能存储在多个 key 下）
    for (const tempEntry of potentiallyOrphanedTempEntries) {
      if (tempEntry.dependedBy.size === 0) {
        for (const [key, entry] of Object.entries(this.tempFilesMap)) {
          if (entry === tempEntry) {
            Reflect.deleteProperty(this.tempFilesMap, key)
          }
        }
      }
    }
  }

  /** 
   * 刷新依赖
   * [TODO] 循环依赖处理
   */
  private refreshDependents(filename: string) {
    const entry = this.filesMap[filename]
    if (!entry) return

    // 遍历所有依赖该文件的文件
    entry.dependedBy.forEach((dependentFilename) => {
      const dependentEntry = this.filesMap[dependentFilename]
      if (!dependentEntry) return

      // 清除错误信息，重新加载
      dependentEntry.errors = {
        runtime: null
      }

      if (isJsxModule(dependentFilename) || matchfile(dependentFilename, this.params.entryFile)) {
        // 如果依赖者是 JSX 组件,触发其 forceUpdate
        // 重新加载该组件模块(清除缓存)
        const reloadedModule = this.loadModule({
          filename: dependentFilename,
          compiled: decodeURIComponent(dependentEntry.file.compiled),
          dependencies: this.proxyDependencies(dependentFilename),
          onRuntimeError: (error: Error) => {
            dependentEntry.errors.runtime = error
            this.params.onRuntimeError(error, dependentEntry.file)
          }
        })
        
        dependentEntry.module!.__default = reloadedModule.default
        // default 导出被删除时同样报错
        dependentEntry.currentImpl = reloadedModule.default
          ? reloadedModule.default
          : () => { throw new Error(`[${dependentFilename}] 默认导出（export default）已被删除或为空`) }
        // 同步命名导出到 dependentEntry.module（如 export const Test = ...）
        this.syncNamedExports(dependentEntry, reloadedModule, dependentFilename)
        dependentEntry.forceUpdateSet.forEach(fn => fn())
      } else if (isJsModule(dependentFilename)) {
        // 被 JS 依赖，递归刷新依赖链
        // 重新加载 JS 模块
        const reloadedModule = this.loadModule({
          filename: dependentFilename,
          compiled: decodeURIComponent(dependentEntry.file.compiled),
          dependencies: this.proxyDependencies(dependentFilename),
          onRuntimeError: (error: Error) => {
            dependentEntry.errors.runtime = error
            this.params.onRuntimeError(error, dependentEntry.file)
          }
        })
        
        dependentEntry.module = reloadedModule

        this.refreshDependents(dependentFilename)
      }
    })
  }

  setVibing(vibing: Vibing) {
    if (this.vibing !== vibing) {
      this.vibing = vibing
      Object.entries(this.filesMap).forEach(([_, entry]) => {
        if (entry.errors.runtime) {
          entry.forceUpdateSet.forEach(fn => fn())
        }
      })
    }
  }

  loadModule(params) {
    return loadModule({
      ...params,
      definitions: this.params.definitions,
      ErrorView: this.params.ErrorView
    })
  }

  /**
   * 同步命名导出到 entry.module，并为函数类型的命名导出（React 组件）创建热更新包装。
   * - 函数类型：创建/更新 NamedExportEntry，更新 currentImpl，触发 forceUpdate，
   *             在 entry.module[key] 上存放 HotComponent 包装（仅首次创建时）。
   * - 非函数类型（变量、对象等）：直接更新 entry.module[key]。
   */
  private syncNamedExports(entry: FilesMap[string], module: ModuleExports, filename: string) {
    if (!entry.namedEntries) {
      entry.namedEntries = {}
    }
    if (!entry.namedVariableKeys) {
      entry.namedVariableKeys = new Set()
    }

    const skippedKeys = new Set(['default', '__default', '__esModule'])

    Object.entries(module).forEach(([key, value]) => {
      if (skippedKeys.has(key)) return

      // 仅当导出名以大写字母开头时，才视为 React 组件并使用热更新包装。
      // 小写开头的函数（如工具函数 renderFeatureIcon）直接透传，避免被错误包装为 HotComponent
      // 导致调用时报 "is not a function" 的错误。
      const isReactComponent = typeof value === 'function' && /^[A-Z]/.test(key)

      if (isReactComponent) {
        // React 组件（大写命名函数）：使用热更新包装
        const existing = entry.namedEntries![key]
        if (existing) {
          // 已有热更新条目：更新 currentImpl 并触发重渲染
          existing.currentImpl = value
          existing.forceUpdateSet.forEach(fn => fn())
        } else {
          // 首次创建：建立子热更新条目并包装成 HotComponent
          const namedEntry: NamedExportEntry = {
            forceUpdateSet: new Set(),
            currentImpl: value,
            errors: { runtime: null }
          }
          entry.namedEntries![key] = namedEntry

          // 创建一个与 NamedExportEntry 兼容的 FilesMap 条目代理，
          // 以便复用 createHotComponent（它需要完整的 entry 类型）
          const pseudoEntry = {
            file: entry.file,
            module: entry.module,
            dependencies: entry.dependencies,
            dependedBy: entry.dependedBy,
            forceUpdateSet: namedEntry.forceUpdateSet,
            errors: namedEntry.errors,
            get currentImpl() { return namedEntry.currentImpl },
            set currentImpl(v) { namedEntry.currentImpl = v }
          } as unknown as FilesMap[string]

          const HotNamedComponent = createHotComponent({
            entry: pseudoEntry,
            LoadingView: this.params.LoadingView,
            ErrorView: this.params.ErrorView,
            getVibing: () => this.vibing,
            onRuntimeError: (error: Error) => {
              namedEntry.errors.runtime = error
              this.params.onRuntimeError(error, entry.file)
            }
          })

          entry.module[key] = HotNamedComponent
        }
      } else {
        // 非 React 组件（小写函数、变量、对象等）：直接更新，并记录 key
        entry.module[key] = value
        entry.namedVariableKeys!.add(key)
      }
    })

    const newModuleKeys = new Set(Object.keys(module))

    // 检查已有命名组件导出中哪些在新模块里被删除了，
    // 将其 currentImpl 替换为抛错函数，ErrorBoundary 会展示错误
    Object.keys(entry.namedEntries!).forEach((key) => {
      if (!newModuleKeys.has(key)) {
        const removedEntry = entry.namedEntries![key]
        const capturedKey = key
        removedEntry.currentImpl = () => {
          throw new Error(`[${filename}] 命名导出 "${capturedKey}" 已被删除`)
        }
        removedEntry.forceUpdateSet.forEach(fn => fn())
      }
    })

    // 检查已有非函数命名导出中哪些被删除了，直接从 module 上移除
    entry.namedVariableKeys!.forEach((key) => {
      if (!newModuleKeys.has(key)) {
        Reflect.deleteProperty(entry.module, key)
        entry.namedVariableKeys!.delete(key)
      }
    })
  }

  createHotComponent(params: { entry: FilesMap[string] }) {
    return createHotComponent({
      ...params,
      LoadingView: this.params.LoadingView,
      ErrorView: this.params.ErrorView,
      getVibing: () => {
        return this.vibing
      },
      onRuntimeError: (error: Error) => {
        params.entry.errors.runtime = error
        this.params.onRuntimeError(error, params.entry.file)
      }
    })
  }

  getErrors() {
    const errors: any[] = []
    if (this.error) {
      errors.push(this.error)
    }

    // 检查入口文件是否缺失
    const entryFile = this.params.entryFile
    const entryExists = Object.keys(this.filesMap).some(filename => filename === entryFile)
    if (!entryExists) {
      errors.push({
        type: '入口文件缺失',
        message: `入口文件 \`${entryFile}\` 缺失，组件无法渲染`
      })
    }

    Object.entries(this.filesMap).forEach(([_, value]: any) => {
      const error = value.errors.runtime
      if (error) {
        errors.push(error)
      }
    })

    const tempFilesMap = this.tempFilesMap
    const missingFiles = extractMissingFiles(tempFilesMap)
    const missingFilesEntries = Object.entries(missingFiles)
    if (missingFilesEntries.length > 0) {
      missingFilesEntries.forEach(([file, info]) => {
        const dependents = Array.from(info.dependedBy).join('、')
        errors.push({
          type: '相对引用错误',
          message: `${dependents} 导入了不存在的文件 ${file}${info.isEntry ? '（入口文件）' : ''}，请检查相对路径是否有误，或缺失该文件`
        })
      })
    }
    this.tempDependencies.forEach((deps, filename) => {
      if (deps.size) {
        errors.push({
          type: '使用不允许的三方依赖',
          message: `${filename} 使用了不允许的三方依赖：${Array.from(deps).join(', ')}`
        })
      }
    })

    return errors
  }
}

export { FileSystem }
export type { FilesMap }