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

interface LoadModuleParams {
  filename: string
  compiled: string
  dependencies: Dependencies
  definitions: Definitions
  ErrorView: ErrorView
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

  const exports = {
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
    if (packageName === 'mybricks') {
      const result = dependencies[packageName]
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
        }
      }
    }

    return dependencies[packageName]
  })
  } catch (e: any) {
    // console.error('[loadModule]', e)
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
    throw enrichedError
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

  /** 临时依赖存储，使用了未注入的依赖 */
  tempDependencies = new Set<string>()

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

    if (isJsxModule(resolvedFilename)) {
      const module = this.loadModule({
        filename: resolvedFilename,
        compiled: decodeURIComponent(entry.file.compiled),
        dependencies: this.proxyDependencies(resolvedFilename),
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

    if (entry) {
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
        })
        entry.file = file
        entry.module!.__default = module.default
        entry.currentImpl = module.default || (() => null)
        entry.forceUpdateSet.forEach(fn => fn())
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
        })
        tempEntry.module!.__default = module.default
        tempEntry.currentImpl = module.default || (() => null)
      }
    } else if (isJsModule(filename)) {
      if (entry) {
        const module = this.loadModule({
          filename,
          compiled: decodeURIComponent(file.compiled),
          dependencies: this.proxyDependencies(filename),
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
          that.tempDependencies.add(key)
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

      if (isJsxModule(dependentFilename)) {
        // 如果依赖者是 JSX 组件,触发其 forceUpdate
        // 重新加载该组件模块(清除缓存)
        const reloadedModule = this.loadModule({
          filename: dependentFilename,
          compiled: decodeURIComponent(dependentEntry.file.compiled),
          dependencies: this.proxyDependencies(dependentFilename),
        })
        
        dependentEntry.module!.__default = reloadedModule.default
        dependentEntry.currentImpl = reloadedModule.default || (() => null)
        dependentEntry.forceUpdateSet.forEach(fn => fn())
      } else if (isJsModule(dependentFilename)) {
        // 被 JS 依赖，递归刷新依赖链
        // 重新加载 JS 模块
        const reloadedModule = this.loadModule({
          filename: dependentFilename,
          compiled: decodeURIComponent(dependentEntry.file.compiled),
          dependencies: this.proxyDependencies(dependentFilename),
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
    const errors: Error[] = []
    if (this.error) {
      errors.push(this.error)
    }
    Object.entries(this.filesMap).forEach(([_, value]: any) => {
      const error = value.errors.runtime
      if (error) {
        errors.push(error)
      }
    })

    const { tempFilesMap } = this
            
    if (Object.keys(tempFilesMap).length > 0) {
      const missingFiles = extractMissingFiles(tempFilesMap)
      // 构建详细的错误信息，包含依赖关系
      const errorDetails = Object.entries(missingFiles)
        .map(([file, info], index) => {
          return `${index ? '、' : ''}\`${file}\``
        })
        .join('')

      errors.push(new Error(`缺失以下依赖文件，组件无法渲染：${errorDetails}`))
    }

    return errors
  }
}

export { FileSystem }
export type { FilesMap }