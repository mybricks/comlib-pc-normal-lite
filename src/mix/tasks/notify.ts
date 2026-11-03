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

/** 无编号任务的 ID 使用完整标题，避免中文标题退化为列表位置。 */
function hashTaskTitle(title: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let i = 0; i < title.length; i++) {
    const code = title.charCodeAt(i)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `legacy-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`
}

function parseTasks(content: string, usePreviousIds: boolean): UserTaskInfo[] {
  const tasks: UserTaskInfo[] = []
  const usedIds = new Set<string>()
  const sections = content.split(/(?=^## )/m).filter((section) => section.startsWith('## '))
  for (const section of sections) {
    const title = section.split('\n')[0].replace(/^#+\s*/, '').trim()
    if (!title) continue
    const summaryMatch = section.match(/^>\s*(.+)/m)
    const rawState = extractTaskField(section, '状态') ?? ''
    const baseId = title.match(/^(T-\d+)\b/)?.[1]
      ?? (usePreviousIds
        ? (title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || String(tasks.length))
        : hashTaskTitle(title))
    let id = baseId
    let suffix = 2
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`
    usedIds.add(id)

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

export function parseTasksForNotify(content: string): UserTaskInfo[] {
  return parseTasks(content, false)
}

/** 兼容历史对话和轮次记录中保存的旧任务 ID。 */
export function resolveTaskId(content: string, id: string): string | undefined {
  const tasks = parseTasksForNotify(content)
  if (tasks.some((task) => task.id === id)) return id
  const index = parseTasks(content, true).findIndex((task) => task.id === id)
  return index < 0 ? undefined : tasks[index]?.id
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
