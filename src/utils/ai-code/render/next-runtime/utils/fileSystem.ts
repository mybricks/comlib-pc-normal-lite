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
  /** 强制刷新 */
  forceUpdate: () => void
  /** 渲染组件 */
  currentImpl: (props: unknown) => ReactElement | null
  /** 清理临时文件 */
  clearTempFiles?: (filename: string) => void
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

  constructor(params: FileSystemParams) {
    this.params = params
  }

  /** 初始化 */
  init(files: Files) {
    files.forEach(file => {
      this.update(file.filename, file)
    })
  }

  /**
   * filename 加载目标
   * from 被谁加载（filename）
   */
  get(filename: string, from?: string) {
    const entry = resolveFilename(filename, this.filesMap)

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
        },
        module,
        dependencies: new Set<string>(),
        dependedBy: new Set<string>(),
        forceUpdate: () => {},
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
        }
      }

      const HotComponent = createHotComponent({ entry: tempEntry })
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

    if (from) {
      const fromEntry = this.filesMap[from]
      // 有来源，记录依赖关系
      // from 依赖 entry
      fromEntry.dependencies.add(resolvedFilename)
      // entry 被 from 依赖
      entry.dependedBy.add(filename)
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

    this.events.emit('fileChange', { filename, type: 'delete' })
  }

  update(filename: string, file: Files[0]) {
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
    // update用于新增和修改
    if (isJsxModule(filename)) {
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

      this.refreshDependents(filename)
    }

    this.events.emit('fileChange', { filename, type: entry ? 'update' : 'create'})
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

        return that.get(currentPath.join('/'), filename)
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

const hackProxy = () => {
  const f = () => {}
  const proxy = new Proxy(f, {
    get() {
      return proxy
    },
    apply(_target, _thisArg, args) {
      if (args[0]?.['data-loc']) {
        // 认为是组件
        return '依赖加载中...'
      }
      return proxy
    }
  })
  return proxy
}
