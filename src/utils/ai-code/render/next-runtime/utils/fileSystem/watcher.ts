import type { FileSystem } from '.'
import type { Files } from '../../types'

// 文件变化事件类型
type FileChangeType = 'create' | 'update' | 'delete'

// 文件变化事件
interface FileChangeEvent {
  /** 变化类型 */
  type: FileChangeType
  /** 文件的最新状态(删除时为 undefined) */
  file: Files[0]
}

// 监听器类型
type FileChangeListener = (event: FileChangeEvent) => void

// 取消订阅函数类型
type Unsubscribe = () => void

/**
 * 文件监听器类
 * 负责管理文件变化的监听和通知
 */
export class FileWatcher {
  /** 文件监听器存储 */
  private _watchers: Map<string, Set<FileChangeListener>> = new Map()

  private _fileSystem: FileSystem

  constructor(fileSystem: FileSystem) {
    this._fileSystem = fileSystem
  }

  /**
   * 监听特定文件的变化
   * @param filename 要监听的文件名
   * @param listener 监听回调函数
   * @returns 取消订阅的函数
   * 
   * @example
   * const unsubscribe = fileWatcher.watch('src/App.tsx', (event) => {
   *   console.log(`文件 ${event.filename} 发生了 ${event.type} 操作`)
   *   console.log('文件内容:', event.file)
   * })
   * 
   * // 取消监听
   * unsubscribe()
   */
  watch(filename: string, listener: FileChangeListener): Unsubscribe {
    if (!this._watchers.has(filename)) {
      this._watchers.set(filename, new Set())
    }
    this._watchers.get(filename)!.add(listener)

    const file = this._fileSystem.filesMap[filename]?.file

    if (file) {
      listener({ file, type: 'create' })
    }

    // 返回取消订阅函数
    return () => {
      const watchers = this._watchers.get(filename)
      if (watchers) {
        watchers.delete(listener)
        if (watchers.size === 0) {
          this._watchers.delete(filename)
        }
      }
    }
  }

  /**
   * 触发文件变化事件
   * @param filename 文件名
   * @param type 变化类型
   * @param file 文件对象(删除时为 undefined)
   */
  emit(filename: string, type: FileChangeType) {

    // 触发特定文件监听器
    const watchers = this._watchers.get(filename)
    if (watchers) {
      const file = this._fileSystem.filesMap[filename]?.file
      if (!file) {
        return
      }
      const event = { file, type }
      watchers.forEach(listener => {
        try {
          listener(event)
        } catch (error) {
          // console.error('[FileWatcher] 监听器执行出错:', error)
        }
      })
    }
  }

  /**
   * 清除所有监听器
   */
  clear() {
    this._watchers.clear()
  }

  /**
   * 清除特定文件的所有监听器
   */
  clearFile(filename: string) {
    this._watchers.delete(filename)
  }
}
