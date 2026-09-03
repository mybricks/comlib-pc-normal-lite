import context from '../../../mix/context'
import { undoRedoManager } from '../../../mix/editors/undoRedo'

export default function (props) {
  // 提交用户操作
  const aiRequests = undoRedoManager.getBranchAIRequests()
  console.log('commitUserActions', aiRequests)
  const message = aiRequests.map((request) => request.message).join('')
  const chips = aiRequests.flatMap((request) => request.chips)
  // const beforeFiles = undoRedoManager.getBranchInitialFiles()
  // const styleOverlays = undoRedoManager.getBranchStyleOverlays()

  console.log('commitUserActions', {message, chips})

  if (message) {
    const componentId = context.component!.params.id
    const sendToAgent = window._sandbox_?.helpers?.sendToAgent

    window._sandbox_?.helpers?.sendToAgent(props.id, {
      message,
      meta: {
        chips
      },
      // extra: {
      //   from: '@commitUserActions'
      // }
    })
  }

  // if (!beforeFiles) return true

  // if (message) {
  //   const componentId = context.component!.params.id
  //   const sendToAgent = window._sandbox_?.helpers?.sendToAgent
  //   if (!sendToAgent) return true

  //   // afterTurn 会消费这份快照，并把整个可视化分支压入主栈。
  //   setPendingVisualAICommit(componentId, beforeFiles, styleOverlays)
  //   sendToAgent(componentId, {
  //     message,
  //     meta: {
  //       chips
  //     },
  //     extra: {
  //       from: '@commitUserActions'
  //     }
  //   })
  //   return true
  // }

  // const command = createVisualEditMainCommand(beforeFiles, getCurrentFileSnapshot(), 'manual', '', styleOverlays)
  // if (command) {
  //   command.execute()
  //   undoRedoManager.record(command)
  // }
  undoRedoManager.clearBranch()
  return true
}