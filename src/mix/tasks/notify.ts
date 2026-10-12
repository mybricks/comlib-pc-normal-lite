import type { UserTaskInfo } from '../context'

type TaskDocumentFile = {
  fileName?: string
  source?: string
}

type FindTaskDocumentOptions = {
  configDirName?: unknown
  fallbackRoot: string
}

const TASK_NOTIFY_STATE: Record<string, UserTaskInfo['state']> = {
  '处理中': 0,
  '待处理': 0,
  '待验证': 1,
  '待验收': 1,
  '待交接': 2,
  '已完成': 3,
}

export function parseTasksForNotify(content: string): UserTaskInfo[] {
  const tasks: UserTaskInfo[] = []
  const sections = content.split(/(?=^## )/m).filter((section) => section.startsWith('## '))
  for (const section of sections) {
    const title = section.split('\n')[0].replace(/^#+\s*/, '').trim()
    if (!title) continue
    const statusMatch = section.match(/\*{1,2}\s*状态\s*\*{0,2}\s*[：:]\s*(.+)/i)
    const summaryMatch = section.match(/^>\s*(.+)/m)
    const rawState = statusMatch?.[1]?.replace(/[*_`]/g, '').trim() ?? ''
    const id = title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || String(tasks.length)

    tasks.push({
      id,
      title,
      desc: summaryMatch?.[1]?.trim() ?? '',
      state: TASK_NOTIFY_STATE[rawState] ?? 0,
    })
  }
  return tasks
}

function normalizeTaskPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
}

export function findTaskDocumentContent(
  files: TaskDocumentFile[],
  { configDirName, fallbackRoot }: FindTaskDocumentOptions,
): string | null {
  const root = typeof configDirName === 'string' && configDirName.trim()
    ? normalizeTaskPath(configDirName)
    : normalizeTaskPath(fallbackRoot)
  const taskFiles = files.filter((file) => normalizeTaskPath(file.fileName ?? '').endsWith('/tasks/TASKS.md'))
  const unbranched = taskFiles.find(
    (file) => normalizeTaskPath(file.fileName ?? '') === `${root}/tasks/TASKS.md`,
  )
  const taskFile = unbranched ?? (taskFiles.length === 1 ? taskFiles[0] : undefined)
  if (!taskFile?.source) return null
  try {
    return decodeURIComponent(taskFile.source)
  } catch {
    return taskFile.source
  }
}
