import context from '../context'
import { getCurrentFileSnapshot } from './visualEditCommit'
import type { VisualStyleOverlay } from './visualStyleOverlay'

let isVibing = false
let stopListeningVibing: (() => void) | undefined

export interface BranchAIRequest {
  message: string
  chips: any[]
}

export interface FileSnapshot {
  path: string
  content: string
}

export interface Command {
  execute(): void
  undo(): void

  /** 当前命令的 userAction 与前一条命令合并时，撤销与重做也必须作为一组执行。 */
  mergeWithPrevious?: boolean

  /**
   * 主栈命令涉及的本地文件。版本记录方可据此只保存实际变更的文件。
   * 分支栈命令只维护画布即时状态，不需要保存版本。
   */
  files?: string[]

  /**
   * 分支操作需要 AI 继续处理时，保留提交 AI 所需的原始请求数据。
   * 只有当前可撤销分支中的命令会被读取，已撤销的命令不会再次提交。
   */
  aiRequest?: BranchAIRequest

  /** Less 可视化编辑的声明式覆盖层；不引用当前 DOM，提交后可由主栈重放。 */
  styleOverlay?: VisualStyleOverlay
}

/**
 * [TODO]
 * 1. 合并策略，目前样式编辑有防抖功能，用户修改后立即回滚可能看不到效果
 */
class UndoRedoManager {
  /** 持久化操作使用的主栈。 */
  private mainUndoStack: Command[] = []
  private mainRedoStack: Command[] = []

  /** 画布即时编辑使用的分支栈，不会创建版本记录。 */
  private branchUndoStack: Command[] = []
  private branchRedoStack: Command[] = []
  /** 分支开始前的完整源码快照，提交时用于生成主栈命令。 */
  private branchInitialFiles: FileSnapshot[] | null = null
  private branchHistoryListeners = new Set<(hasHistory: boolean) => void>()

  getBranchInitialFiles(): FileSnapshot[] | null {
    return this.branchInitialFiles?.map((file) => ({ ...file })) ?? null
  }

  /** 当前是否存在未提交的可视化编辑分支。 */
  hasBranchHistory() {
    return this.branchUndoStack.length > 0
  }

  /** 订阅可视化编辑分支状态，供外部禁用会冲突的操作。 */
  onBranchHistoryChange(listener: (hasHistory: boolean) => void) {
    listener(this.hasBranchHistory())
    this.branchHistoryListeners.add(listener)
    return () => {
      this.branchHistoryListeners.delete(listener)
    }
  }

  private notifyBranchHistoryChange() {
    const hasHistory = this.hasBranchHistory()
    this.branchHistoryListeners.forEach((listener) => listener(hasHistory))
  }

  /** 执行命令 */
  execute(command: Command) {
    command.execute()
    this.record(command)
  }

  /** 执行画布即时编辑。 */
  executeBranch(command: Command) {
    const isNewBranch = !this.branchInitialFiles && !this.branchUndoStack.length && !this.branchRedoStack.length
    if (isNewBranch) {
      this.branchInitialFiles = getCurrentFileSnapshot()
    }

    const userActionRecordCount = context.getUserActionRecordCount()
    try {
      command.execute()
    } catch (error) {
      if (isNewBranch) {
        this.branchInitialFiles = null
      }
      throw error
    }
    command.mergeWithPrevious = context.hasMergedUserActionSince(userActionRecordCount)
    this.recordBranch(command)
  }

  /**
   * 记录一个已执行过的命令（不再重复调用 execute），仅将其压入撤回堆栈。
   * 适用于命令在调用前已经执行完毕的场景（如 AI 修改、拖拽等连续快速修改）。
   */
  record(command: Command) {
    this.mainUndoStack.push(command)
    this.mainRedoStack = []
  }

  /** 记录一个已执行过的画布即时编辑。 */
  recordBranch(command: Command) {
    this.branchUndoStack.push(command)
    this.branchRedoStack = []
    this.notifyBranchHistoryChange()
  }

  /** 获取当前分支中仍生效的 AI 请求，供用户最终提交时统一发送。 */
  getBranchAIRequests(): BranchAIRequest[] {
    return this.branchUndoStack
      .map((command) => command.aiRequest)
      .filter((request): request is BranchAIRequest => !!request)
  }

  /** 获取当前分支中仍生效的 Less 覆盖层，供提交后的主栈维护。 */
  getBranchStyleOverlays(): VisualStyleOverlay[] {
    return this.branchUndoStack
      .map((command) => command.styleOverlay)
      .filter((overlay): overlay is VisualStyleOverlay => !!overlay)
      .map((overlay) => ({ ...overlay }))
  }

  /** 放弃分支历史；用于画布销毁或完成一次分支合并后。 */
  clearBranch() {
    this.branchUndoStack = []
    this.branchRedoStack = []
    this.branchInitialFiles = null
    context.resetUserActionRecords()
    this.notifyBranchHistoryChange()
  }

  /**
   * 取消当前可视化编辑会话：逆序回退所有仍生效的分支命令，
   * 已被单独撤销的命令无需再次执行，最后丢弃整段分支历史。
   */
  cancelBranch() {
    while (this.branchUndoStack.length) {
      this.undoStack(this.branchUndoStack, this.branchRedoStack)
    }
    this.clearBranch()
  }

  /**
   * AI 未产生源码变更时，撤销其乐观 DOM 与用户事件；
   * 本地分支命令保持原状，随后由调用方统一清空分支。
   */
  rollbackAIBranchCommands() {
    for (let index = this.branchUndoStack.length - 1; index >= 0; index -= 1) {
      const command = this.branchUndoStack[index]
      if (command.aiRequest) {
        command.undo()
      }
    }
  }

  private undoStack(undoStack: Command[], redoStack: Command[], mergeUserActions = false) {
    let command = undoStack.pop()
    if (!command) return

    do {
      command.undo()
      redoStack.push(command)
      command = mergeUserActions && command.mergeWithPrevious ? undoStack.pop() : undefined
    } while (command)
  }

  private redoStack(undoStack: Command[], redoStack: Command[], mergeUserActions = false) {
    let command = redoStack.pop()
    if (!command) return

    do {
      command.execute()
      undoStack.push(command)
      command = mergeUserActions && !!redoStack[redoStack.length - 1]?.mergeWithPrevious
        ? redoStack.pop()
        : undefined
    } while (command)
  }

  /** 撤销 */
  undo() {
    if (this.branchUndoStack.length) {
      console.log('undo branch')
      this.undoStack(this.branchUndoStack, this.branchRedoStack, true)
      this.notifyBranchHistoryChange()
      return
    }

    console.log('undo stack')

    this.undoStack(this.mainUndoStack, this.mainRedoStack)
  }

  /** 重做 */
  redo() {
    if (this.branchRedoStack.length) {
      console.log('redo branch')
      this.redoStack(this.branchUndoStack, this.branchRedoStack, true)
      this.notifyBranchHistoryChange()
      return
    }

    console.log('redo stack')

    this.redoStack(this.mainUndoStack, this.mainRedoStack)
  }
}

const undoRedoManager = new UndoRedoManager()

export { undoRedoManager }


// ─── 默认导出：供编辑器快捷键系统调用 ────────────────────────────────────────
export default function() {
  if (!stopListeningVibing && context.component) {
    stopListeningVibing = context.component.events.on('vibing', (vibing) => {
      isVibing = vibing
    })
  }

  return {
    /** 撤销 */
    '@undo'() {
      console.log('@undo', isVibing)
      if (isVibing) return
      undoRedoManager.undo()
    },
    /** 重做 */
    '@redo'() {
      console.log('@redo', isVibing)
      if (isVibing) return
      undoRedoManager.redo()
    }
  }
}

window._undo = () => {
  console.log('@undo', isVibing)
  if (isVibing) return
  undoRedoManager.undo()
}

window._redo = () => {
  console.log('@redo', isVibing)
  if (isVibing) return
  undoRedoManager.redo()
}
