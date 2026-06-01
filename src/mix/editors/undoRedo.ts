class Command {
  execute() {
    throw new Error('execute() 方法必须由子类实现');
  }
  
  undo() {
    throw new Error('undo() 方法必须由子类实现');
  }
}

/**
 * [TODO]
 * 1. 合并策略，目前样式编辑有防抖功能，用户修改后立即回滚可能看不到效果
 */
class UndoRedoManager {
  private maxStackSize = 50

  /** 撤回堆栈 */
  private undoStack: any[] = []

  /** 重做堆栈 */
  private redoStack: any[] = []

  /** 执行命令 */
  execute(command: Command) {
    command.execute()

    this.record(command)
  }

  /**
   * 记录一个已执行过的命令（不再重复调用 execute），仅将其压入撤回堆栈。
   * 适用于命令在调用前已经执行完毕的场景（如 AI 修改、拖拽等连续快速修改）。
   */
  record(command: Command) {
    this.undoStack.push(command)
    this.redoStack = []

    // 限制栈大小
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift()
    }
  }

  /** 撤销 */
  undo() {
    if (this.undoStack.length === 0) {
      // 没有可撤销操作
      return
    }
    
    const command = this.undoStack.pop()
    command.undo()

    this.redoStack.push(command)
  }

  /** 重做 */
  redo() {
    if (this.redoStack.length === 0) {
      // 没有可重做操作
      return
    }
    
    const command = this.redoStack.pop()
    command.execute()

    this.undoStack.push(command);
    
    // 限制栈大小
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
  }
}

const undoRedoManager = new UndoRedoManager()

export { undoRedoManager }


// ─── 默认导出：供编辑器快捷键系统调用 ────────────────────────────────────────
export default function() {
  return {
    /** 撤销 */
    '@undo'() {
      console.log('@undo')
      undoRedoManager.undo()
    },
    /** 重做 */
    '@redo'() {
      console.log('@redo')
      undoRedoManager.redo()
    }
  }
}
