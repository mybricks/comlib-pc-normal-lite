import changeOrder from './changeOrder'
import updateText from './updateText'
import runDelete from './delete'
import context from '../../context'
import { undoRedoManager } from '../undoRedo'
import {
  createVisualEditMainCommand,
  getCurrentFileSnapshot,
  setPendingVisualAICommit,
} from '../visualEditCommit'

export default function () {
  return {
    '@updateSegment'(ctx: any, type: string, options: any) {
      if (type === 'cutTo') {
        return changeOrder(options)
      } else if (type === 'updateText') {
        return updateText(options)
      } else if (type === 'delete') {
        return runDelete(options)
      }
    },
    '@commitUserActions'() {
      // 提交用户操作
      const aiRequests = undoRedoManager.getBranchAIRequests()
      const message = aiRequests.map((request) => request.message).join('')
      const chips = aiRequests.flatMap((request) => request.chips)
      const beforeFiles = undoRedoManager.getBranchInitialFiles()
      const styleOverlays = undoRedoManager.getBranchStyleOverlays()

      if (!beforeFiles) return

      if (message) {
        const componentId = context.component!.params.id
        const sendToAgent = window._sandbox_?.helpers?.sendToAgent
        if (!sendToAgent) return

        // afterTurn 会消费这份快照，并把整个可视化分支压入主栈。
        setPendingVisualAICommit(componentId, beforeFiles, styleOverlays)
        sendToAgent(componentId, {
          message,
          meta: {
            chips
          }
        })
        return
      }

      const command = createVisualEditMainCommand(beforeFiles, getCurrentFileSnapshot(), 'manual', '', styleOverlays)
      if (command) {
        command.execute()
        undoRedoManager.record(command)
      }
      undoRedoManager.clearBranch()
    },
    '@cancelUserActions'(...args) {
      // 取消用户操作
      undoRedoManager.cancelBranch()
    }
  }
}
