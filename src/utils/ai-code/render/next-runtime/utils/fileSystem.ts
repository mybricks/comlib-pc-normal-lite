import { ReactElement } from 'react'
import { Events } from './events'
import createHotComponent from './HotComponent'
import type { Files, Dependencies, Css, Vibing } from '../types'

interface LoadModuleParams {
  filename: string
  compiled: string
  dependencies: Dependencies
}
interface ModuleExports {
  default: any
  __default: any
  [key: string]: any
}
const loadModule = (params: LoadModuleParams): ModuleExports => {
  const { filename, compiled, dependencies } = params

  const exports = {
    default: null,
    __default: null
  }

  try {
    eval(`(function(exports, require) {
      ${compiled}
      //# sourceURL=${filename}
    })`)(exports, (packageName: string) => {
    return dependencies[packageName]
  })
  } catch (e: any) {
    console.error('[TODO - loadModule]', e)
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
}
const loadCssModule = (params: LoadCssParams) => {
  const { file, css } = params;
  const compiled = decodeURIComponent(file.compiled)
  const cssModule = JSON.parse(compiled);
  const { cssContent, classMap } = cssModule;
  const proxy = new Proxy({}, {
    get(_, key: string) {
      if (key === 'default') {
        return proxy
      }
      return classMap[key] || key
    }
  })

  const module = {
    default: proxy
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

const resolveFilename = (filename: string, filesMap: FilesMap) => {
  let entry = filesMap[filename]
  let resolvedFilename = filename

  // 如果找不到,尝试添加后缀查找
  if (!entry) {
    for (const ext of RESOLVE_EXTENSIONS) {
      resolvedFilename = filename + ext
      if (filesMap[resolvedFilename]) {
        entry = filesMap[resolvedFilename]
        break
      }
      resolvedFilename = filename + '/index' + ext
      if (filesMap[resolvedFilename]) {
        entry = filesMap[resolvedFilename]
        break
      }
    }
  }

  return entry
}

interface FileSystemParams {
  dependencies: Dependencies
  css: Css
}

type FilesMap = Record<string, {
  file: Files[0]
  module: {
    default: any
    [key: string]: any
  } | null
  /** 该文件依赖的文件列表 */
  dependencies: Set<string>
  /** 依赖该文件的文件列表 */
  dependedBy: Set<string>
  forceUpdate: () => void
  currentImpl: (props: unknown) => ReactElement | null
}>

class FileSystem {
  /** 参数 */
  params: FileSystemParams

  /** 文件名映射到文件信息 */
  filesMap: FilesMap = {}

  /** 事件 */
  events = new Events<{
    init: boolean
  }>({})

  /** vibing状态 */
  vibing: Vibing = false

  constructor(params: FileSystemParams) {
    this.params = params
  }

  /** 初始化 */
  init(files: Files) {
    console.log('[files]', files)
    files.forEach(file => {
      if (file.filename === "pages/GradeQueryPage/GradeTable/index.jsx") {
        return
      }
      this.filesMap[file.filename] = {
        file,
        module: null,
        dependencies: new Set(),
        dependedBy: new Set(),
        forceUpdate: () => {},
        currentImpl: () => null
      }
    })
    this.events.emit('init', true)
  }

  /**
   * filename 加载目标
   * from 被谁加载（filename）
   */
  get(filename: string, options?: { from: FilesMap[string], oriKey: string }) {
    const entry = resolveFilename(filename, this.filesMap)

    if (!entry) {
      if (options) {
        const { from, oriKey } = options
        console.error('[TODO]', filename, this.filesMap)

        console.log('[from]', { from, oriKey })
        const dependency = from.file.dependencies[oriKey]
        console.log('dependency', dependency)
      }


              // index.jsx 可能带后缀
        // pages/ButtonPage/ButtonGroup 可能不带后缀

      return
    }

    if (entry.module) {
      return entry.module
    }

    const resolvedFilename = entry.file.filename

    if (isJsxModule(resolvedFilename)) {
      const module = loadModule({
        filename: resolvedFilename,
        compiled: decodeURIComponent(entry.file.compiled),
        dependencies: this.proxyDependencies(resolvedFilename)
      })

      module.__default = module.default
      // 将实际的组件函数赋值给 currentImpl
      entry.currentImpl = module.__default || (() => null)
      const HotComponent = createHotComponent({ entry })
      module.default = HotComponent
      entry.module = module
    } else if (isJsModule(resolvedFilename)) {
      const module = loadModule({
        filename: resolvedFilename,
        compiled: decodeURIComponent(entry.file.compiled),
        dependencies: this.proxyDependencies(resolvedFilename)
      })

      entry.module = module
    } else if (isCssModule(resolvedFilename)) {
      const { module } = loadCssModule({ file: entry.file, css: this.params.css })

      entry.module = module
    }

    if (options) {
      const { from } = options
      // 有来源，记录依赖关系
      // from 依赖 entry
      from.dependencies.add(resolvedFilename)
      // entry 被 from 依赖
      entry.dependedBy.add(from.file.filename)
    }

    return entry.module
  }

  delete(filename: string) {
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
  }

  update(filename: string, file: Files[0]) {
    // [TODO] 考虑编译报错的情况
    // update用于新增和修改
    if (isJsxModule(filename)) {
      const entry = this.filesMap[filename]

      if (entry) {
        const module = loadModule({
          filename,
          compiled: decodeURIComponent(file.compiled),
          dependencies: this.proxyDependencies(filename)
        })
        entry.file = file
        entry.module!.__default = module.default
        entry.currentImpl = module.default || (() => null)
        entry.forceUpdate()
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
          forceUpdate: () => {},
          currentImpl: () => null
        }
        const module = loadModule({
          filename,
          compiled: decodeURIComponent(file.compiled),
          dependencies: this.proxyDependencies(filename)
        })
        module.__default = module.default
        this.filesMap[filename].module = module
        this.filesMap[filename].currentImpl = module.__default || (() => null)
      }
    } else if (isJsModule(filename)) {
      const entry = this.filesMap[filename]

      if (entry) {
        const module = loadModule({
          filename,
          compiled: decodeURIComponent(file.compiled),
          dependencies: this.proxyDependencies(filename)
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
          forceUpdate: () => {},
          currentImpl: () => null
        }
        const module = loadModule({
          filename,
          compiled: decodeURIComponent(file.compiled),
          dependencies: this.proxyDependencies(filename)
        })
        this.filesMap[filename].module = module
      }

      this.refreshDependents(filename)
    } else if (isCssModule(filename)) {
      // 如果是less文件，解析后再次调用css即可
      // [TODO] 目前不存在引用关系
      const { module } = loadCssModule({ file, css: this.params.css })
      const entry = this.filesMap[filename]

      if (entry) {
        entry.file = file
        entry.module = module
      } else {
        this.filesMap[filename] = {
          file,
          module,
          dependencies: new Set(),
          dependedBy: new Set(),
          forceUpdate: () => {},
          currentImpl: () => null
        }
      }
    }
  }

  /** 依赖代理，读取相对路径引用 */
  proxyDependencies(filename: string) {
    const that = this;
    return new Proxy(this.params.dependencies, {
      get(target, key: string) {
        if (key in target) {
          return target[key];
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

        const currentEntry = that.filesMap[filename]

        return that.get(currentPath.join('/'), {
          from: currentEntry,
          oriKey: key
        })
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
        const reloadedModule = loadModule({
          filename: dependentFilename,
          compiled: decodeURIComponent(dependentEntry.file.compiled),
          dependencies: this.proxyDependencies(dependentFilename)
        })
        
        dependentEntry.module!.__default = reloadedModule.default
        dependentEntry.currentImpl = reloadedModule.default || (() => null)
        dependentEntry.forceUpdate()
      } else if (isJsModule(dependentFilename)) {
        // 被 JS 依赖，递归刷新依赖链
        // 重新加载 JS 模块
        const reloadedModule = loadModule({
          filename: dependentFilename,
          compiled: decodeURIComponent(dependentEntry.file.compiled),
          dependencies: this.proxyDependencies(dependentFilename)
        })
        
        dependentEntry.module = reloadedModule

        this.refreshDependents(dependentFilename)
      }
    })
  }

  setVibing(vibing: Vibing) {
    this.vibing = vibing
  }
}

export { FileSystem }
export type { FilesMap }
