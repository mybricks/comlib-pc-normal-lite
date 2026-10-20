import type { LayoutFileUpdate } from './layoutTypes'

type FileWriter = (fileName: string, content: string, updateSource?: 'undo' | 'rollback') => void

/** updateFile 可能吞掉编译异常，所以还需检查错误列表。失败时回滚已尝试的文件。 */
export function commitLayoutFiles(
  updates: LayoutFileUpdate[], write: FileWriter,
  getErrors: () => Array<{ file?: string; message?: string }>, undo = false,
): void {
  const applied: LayoutFileUpdate[] = []
  try {
    for (const update of updates) {
      applied.push(update)
      write(update.fileName, undo ? update.previous : update.current, undo ? 'undo' : undefined)
      const error = getErrors().find(error => error.file === update.fileName)
      if (error) throw new Error(`布局源码更新失败：${update.fileName}，${error.message || ''}`)
    }
  } catch (error) {
    const failures: string[] = []
    for (const update of applied.reverse()) {
      try {
        write(update.fileName, undo ? update.current : update.previous, 'rollback')
        if (getErrors().some(error => error.file === update.fileName)) failures.push(update.fileName)
      } catch { failures.push(update.fileName) }
    }
    if (failures.length) throw new Error(`布局更新失败，且以下文件未能恢复：${failures.join(', ')}`)
    throw error
  }
}
