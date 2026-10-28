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

/** 兼容 `**标签**：值`、`**标签：** 值` 与普通 `标签：值` 三种 TASKS.md 写法。 */
function extractTaskField(section: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const field = new RegExp(`^\\s*-\\s*(?:[*_\\x60]\\s*)*${escaped}(?:\\s*[*_\\x60])*\\s*[：:]\\s*(.+)$`, 'm')
  const match = section.replace(/\*{1,2}/g, '').match(field)
  return match?.[1]?.replace(/[*_`]/g, '').trim() || undefined
}

function isVerificationConditionHeading(line: string): boolean {
  const normalized = line.replace(/[*_`]/g, '')
  // task-first 固定使用独立的 `**验证条件**：`，紧跟编号列表。
  return /^\s*(?:(?:#{2,4}\s+)|(?:-\s*))?验证条件\s*[：:]?\s*$/.test(normalized)
}

function isMetadataLine(line: string): boolean {
  const normalized = line.replace(/[*_`]/g, '')
  return /^\s*-\s*[^：:]+[：:]\s*\S/.test(normalized)
}

function extractVerification(section: string): string | undefined {
  const inline = extractTaskField(section, '验证条件')
  if (inline) return inline

  const lines = section.split('\n')
  const start = lines.findIndex((line) => {
    return isVerificationConditionHeading(line)
  })
  if (start < 0) return undefined

  const values: string[] = []
  for (const line of lines.slice(start + 1)) {
    const normalized = line.replace(/[*_`]/g, '').trim()
    if (/^#{1,4}\s+/.test(normalized)) break
    if (isMetadataLine(normalized)) break
    // 仅定位验证条件区块；正文按 TASKS.md 原文透传。
    values.push(line)
  }
  const content = values.join('\n').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')
  return content || undefined
}

export function parseTasksForNotify(content: string): UserTaskInfo[] {
  const tasks: UserTaskInfo[] = []
  const sections = content.split(/(?=^## )/m).filter((section) => section.startsWith('## '))
  for (const section of sections) {
    const title = section.split('\n')[0].replace(/^#+\s*/, '').trim()
    if (!title) continue
    const summaryMatch = section.match(/^>\s*(.+)/m)
    const rawState = extractTaskField(section, '状态') ?? ''
    const id = title.match(/^(T-\d+)\b/)?.[1]
      ?? (title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || String(tasks.length))

    tasks.push({
      id,
      title,
      desc: summaryMatch?.[1]?.trim() ?? '',
      verification: extractVerification(section),
      handoverTo: extractTaskField(section, '交接给'),
      state: TASK_NOTIFY_STATE[rawState] ?? 0,
    })
  }
  return tasks
}

function normalizeTaskPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
}

export function findTaskDocumentFile(
  files: TaskDocumentFile[],
  { configDirName, fallbackRoot }: FindTaskDocumentOptions,
): TaskDocumentFile | undefined {
  const root = typeof configDirName === 'string' && configDirName.trim()
    ? normalizeTaskPath(configDirName)
    : normalizeTaskPath(fallbackRoot)
  const taskFiles = files.filter((file) => normalizeTaskPath(file.fileName ?? '').endsWith('/tasks/TASKS.md'))
  const unbranched = taskFiles.find(
    (file) => normalizeTaskPath(file.fileName ?? '') === `${root}/tasks/TASKS.md`,
  )
  return unbranched ?? (taskFiles.length === 1 ? taskFiles[0] : undefined)
}

export function findTaskDocumentContent(
  files: TaskDocumentFile[],
  options: FindTaskDocumentOptions,
): string | null {
  const taskFile = findTaskDocumentFile(files, options)
  if (!taskFile?.source) return null
  try {
    return decodeURIComponent(taskFile.source)
  } catch {
    return taskFile.source
  }
}
