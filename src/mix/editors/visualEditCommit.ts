import context from '../context'
import type { VersionRecord } from '../context'
import type { Command, FileSnapshot } from './undoRedo'
import type { VisualStyleOverlay } from './visualStyleOverlay'
import { applyVisualStyleOverlay, removeVisualStyleOverlay } from './visualStyleOverlay'

let pendingVisualAICommit: { comId: string; beforeFiles: FileSnapshot[]; styleOverlays: VisualStyleOverlay[] } | null = null

export const getCurrentFileSnapshot = (): FileSnapshot[] => (
  (context.component?.params?.data?.files ?? [])
    .filter((file: any) => typeof file?.source === 'string')
    .map((file: any) => ({
      path: file.fileName,
      content: decodeURIComponent(file.source),
    }))
)

const getChangedFileNames = (beforeFiles: FileSnapshot[], afterFiles: FileSnapshot[]) => {
  const before = new Map(beforeFiles.map((file) => [file.path, file.content]))
  const after = new Map(afterFiles.map((file) => [file.path, file.content]))
  const names = new Set([...before.keys(), ...after.keys()])

  return [...names].filter((fileName) => before.get(fileName) !== after.get(fileName))
}

const applySnapshot = (targetFiles: FileSnapshot[], changedFiles: string[]) => {
  const target = new Map(targetFiles.map((file) => [file.path, file.content]))
  const current = new Set(
    (context.component?.params?.data?.files ?? []).map((file: any) => file.fileName)
  )

  changedFiles.forEach((fileName) => {
    const content = target.get(fileName)
    if (content == null) {
      if (current.has(fileName)) {
        context.updateFile({ fileName, type: 'delete' })
      }
      return
    }

    // 主栈通过正常文件更新将临时源码改动写入文件系统；Less 的即时画布效果由声明式覆盖层维持。
    context.updateFile({ fileName, content, type: undefined })
  })
}

export interface VisualEditMainCommand extends Command {
  getVersionRecord(): VersionRecord | undefined
}

export const createVisualEditMainCommand = (
  beforeFiles: FileSnapshot[],
  afterFiles: FileSnapshot[],
  versionType: 'manual' | 'ai' = 'manual',
  turnId = '',
  styleOverlays: VisualStyleOverlay[] = [],
): VisualEditMainCommand | null => {
  const files = getChangedFileNames(beforeFiles, afterFiles)
  if (!files.length) return null

  let versionRecord: VersionRecord | undefined
  let isInitialExecution = true
  const saveVersion = (type: 'manual' | 'ai') => {
    versionRecord = type === 'ai'
      ? context.saveVisualEditVersion(files, 'ai', turnId)
      : undefined

    if (type === 'manual') {
      context.saveManualVersion(files)
    }
  }

  return {
    files,
    execute() {
      applySnapshot(afterFiles, files)
      styleOverlays.forEach(applyVisualStyleOverlay)
      saveVersion(isInitialExecution ? versionType : 'manual')
      isInitialExecution = false
    },
    undo() {
      applySnapshot(beforeFiles, files)
      ;[...styleOverlays].reverse().forEach(removeVisualStyleOverlay)
      saveVersion('manual')
    },
    getVersionRecord() {
      return versionRecord
    },
  }
}

/** 当前产品保证同时最多一个 AI 请求，因此用模块级状态关联提交与 afterTurn。 */
export const setPendingVisualAICommit = (
  comId: string,
  beforeFiles: FileSnapshot[],
  styleOverlays: VisualStyleOverlay[] = [],
) => {
  pendingVisualAICommit = {
    comId,
    beforeFiles: beforeFiles.map((file) => ({ ...file })),
    styleOverlays: styleOverlays.map((overlay) => ({ ...overlay })),
  }
}

export const takePendingVisualAICommit = (comId: string) => {
  if (!pendingVisualAICommit || pendingVisualAICommit.comId !== comId) return null
  const pending = pendingVisualAICommit
  pendingVisualAICommit = null
  return pending
}
