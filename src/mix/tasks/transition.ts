export type TaskStatus = '待处理' | '处理中' | '待验证' | '待交接' | '已完成'

const STATUS_LINE = /^(\s*-\s*\*{1,2}\s*状态\s*\*{0,2}\s*[：:]\s*)(.+)$/m
const UPDATED_AT_LINE = /^(\s*-\s*\*{1,2}\s*更新时间\s*\*{0,2}\s*[：:]\s*)(.+)$/m

function getTaskSectionId(section: string): string | undefined {
  if (!/^## /.test(section)) return undefined
  const titleLine = section.split('\n')[0]
  return titleLine.replace(/^## /, '').trim().match(/^(T-\d+)\b/)?.[1]
}

function normalizeStatus(raw: string | undefined): string | undefined {
  return raw?.replace(/[*_`\s]/g, '')
}

function formatNow(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 读取任务当前状态，找不到任务或状态行时返回 undefined。 */
export function readTaskStatus(content: string, taskId: string): string | undefined {
  const section = content.split(/(?=^## )/m).find((item) => getTaskSectionId(item) === taskId)
  if (!section) return undefined
  return normalizeStatus(section.match(STATUS_LINE)?.[2])
}

/**
 * 修改 TASKS.md 中指定任务的状态与更新时间，只改动该任务所在的 section。
 * 传入 `from` 时，仅当任务当前状态与之一致才会修改（用于防止基于过期视图覆盖 AI 刚写入的状态）。
 * 没有发生修改时原样返回 content。
 */
export function applyTaskTransition(
  content: string,
  taskId: string,
  targetStatus: TaskStatus,
  options: { from?: TaskStatus } = {},
): string {
  const timestamp = formatNow()
  let changed = false

  const result = content.split(/(?=^## )/m).map((section) => {
    if (getTaskSectionId(section) !== taskId) return section
    if (!STATUS_LINE.test(section)) return section
    if (options.from && normalizeStatus(section.match(STATUS_LINE)?.[2]) !== options.from) return section

    let updated = section.replace(STATUS_LINE, `$1${targetStatus}`)
    if (UPDATED_AT_LINE.test(updated)) {
      updated = updated.replace(UPDATED_AT_LINE, `$1${timestamp}`)
    } else {
      const lines = updated.split('\n')
      lines.splice(1, 0, `- **更新时间**：${timestamp}`)
      updated = lines.join('\n')
    }
    changed = true
    return updated
  }).join('')

  return changed ? result : content
}
