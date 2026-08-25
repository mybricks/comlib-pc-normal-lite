import changeOrder from './changeOrder'
import updateText from './updateText'
import runDelete from './delete'
import context, { config } from '../../context'
import { undoRedoManager } from '../undoRedo'
import {
  createVisualEditMainCommand,
  getCurrentFileSnapshot,
  setPendingVisualAICommit,
} from '../visualEditCommit'
import insert from './insert'

export default function () {
  return {
    '@updateSegment'(ctx: any, type: string, options: any) {
      if (type === 'cutTo') {
        return changeOrder(options)
      } else if (type === 'updateText') {
        return updateText(options)
      } else if (type === 'delete') {
        return runDelete(options)
      } else if (type === 'insert') {
        return insert(options)
      }
    },
    '@commitUserActions'() {

      if (context.connectToAIRef.disabledHandler?.isDisabled()) {
        // 取消用户操作
        // undoRedoManager.cancelBranch()
        context.connectToAIRef.disabledHandler.message('当前没有编辑权限，请在右上角上锁后编辑')
        // 不取消用户操作
        return false
      }

      // 提交用户操作
      const aiRequests = undoRedoManager.getBranchAIRequests()
      const message = aiRequests.map((request) => request.message).join('')
      const chips = aiRequests.flatMap((request) => request.chips)
      const beforeFiles = undoRedoManager.getBranchInitialFiles()
      const styleOverlays = undoRedoManager.getBranchStyleOverlays()

      if (!beforeFiles) return true

      if (message) {
        const componentId = context.component!.params.id
        const sendToAgent = window._sandbox_?.helpers?.sendToAgent
        if (!sendToAgent) return true

        // afterTurn 会消费这份快照，并把整个可视化分支压入主栈。
        setPendingVisualAICommit(componentId, beforeFiles, styleOverlays)
        sendToAgent(componentId, {
          message,
          meta: {
            chips
          },
          extra: {
            from: '@commitUserActions'
          }
        })
        return true
      }

      // local-iframe 的文件由本地服务维护，context.files 不包含最新内容；
      // 保留已执行的分支命令，避免提交后撤销栈为空。
      if (config.getFrontendMode() === 'local-iframe') {
        undoRedoManager.commitBranch()
        return true
      }

      const command = createVisualEditMainCommand(beforeFiles, getCurrentFileSnapshot(), 'manual', '', styleOverlays)
      if (command) {
        command.execute()
        undoRedoManager.record(command)
      } else {
        // 没有源码快照变化时仍可能存在仅作用于画布的分支命令。
        undoRedoManager.commitBranch()
        return true
      }
      undoRedoManager.clearBranch()
      return true
    },
    '@cancelUserActions'(...args) {
      // 取消用户操作
      undoRedoManager.cancelBranch()
      return true
    }
  }
}
