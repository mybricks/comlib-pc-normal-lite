import { undoRedoManager } from '../../../mix/editors/undoRedo'

export default function () {
  // 取消用户操作
  undoRedoManager.cancelBranch()
  return true
}