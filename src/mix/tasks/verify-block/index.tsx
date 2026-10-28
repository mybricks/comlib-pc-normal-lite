import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import context, { type UserTaskInfo } from '../../context'
import i18n from '../../../helpers/i18n'
import { parseTasksForNotify } from '../notify'
import { applyTaskTransition, type TaskStatus } from '../transition'
import { TaskCardHeading } from '../task-card'
import css from './index.less'

interface TaskSandbox {
  files: {
    read: (path: string) => Promise<{ content: string } | null>
    write: (file: { path: string; content: string }) => Promise<void>
  }
}

export function createTasksManager(comId: string) {
  return {
    createVerification: ({ sandbox, taskPath }: { sandbox: TaskSandbox; taskPath: string }) =>
      createTaskVerification({ comId, sandbox, taskPath }),
  }
}

const copy = {
  title: () => i18n({ zh: '请先完成以下任务的验证，再使用AI', en: 'Please verify the following tasks before using AI.' }),
  relatedTitle: () => i18n({ zh: '相关任务', en: 'Related tasks' }),
  allHandled: () => i18n({ zh: '全部已处理', en: 'All handled' }),
  status: (status: TaskStatus) => {
    const labels: Record<TaskStatus, { zh: string; en: string }> = {
      '待处理': { zh: '待处理', en: 'To do' },
      '处理中': { zh: '处理中', en: 'In progress' },
      '待验证': { zh: '待验证', en: 'Needs verification' },
      '待交接': { zh: '待交接', en: 'Pending handoff' },
      '已完成': { zh: '已完成', en: 'Completed' },
    }
    return i18n(labels[status])
  },
  verification: () => i18n({ zh: '验证条件', en: 'Verification' }),
  noVerification: () => i18n({ zh: '暂无验证条件，请自行确认效果', en: 'No verification steps. Please check the result yourself.' }),
  pass: () => i18n({ zh: '符合预期', en: 'Looks good' }),
  reject: () => i18n({ zh: '不符合预期', en: 'Not as expected' }),
  undo: () => i18n({ zh: '撤销', en: 'Undo' }),
  cancel: () => i18n({ zh: '取消', en: 'Cancel' }),
  confirm: () => i18n({ zh: '确认', en: 'Confirm' }),
  reasonPlaceholder: () => i18n({ zh: '哪里不符合预期？', en: 'What is off?' }),
  noReason: () => i18n({ zh: '未填写原因', en: 'No reason given' }),
  passedHint: () => i18n({ zh: '已通过验证', en: 'Verified' }),
  submittedHint: () => i18n({ zh: '已提交给 AI', en: 'Sent to AI' }),
  barText: (count: number) => i18n({ zh: `${count} 个任务待提交`, en: `${count} task${count === 1 ? '' : 's'} ready to submit` }),
  submit: () => i18n({ zh: '提交给 AI 修改', en: 'Send to AI' }),
  prev: () => i18n({ zh: '上一个', en: 'Previous' }),
  next: () => i18n({ zh: '下一个', en: 'Next' }),
  goTo: (index: number) => i18n({ zh: `查看第 ${index} 个任务`, en: `Go to task ${index}` }),
  failed: () => i18n({ zh: '任务状态更新失败，请重试', en: 'Failed to update task status. Please try again.' }),
  outdated: () => i18n({ zh: '任务状态已变化，已为你刷新', en: 'Task status has changed and was refreshed' }),
  feedbackHeader: () => i18n({
    zh: '以下任务验证未通过，已改为待处理，请根据反馈继续修改，修改完成后再次提交验证：',
    en: 'The following tasks did not pass verification and were marked as to do. Please revise them based on the feedback and resubmit for verification:',
  }),
  feedbackReason: () => i18n({ zh: '反馈', en: 'Feedback' }),
}

const STATUS_CLASS: Record<TaskStatus, string> = {
  '待处理': 'doing',
  '处理中': 'doing',
  '待验证': 'verify',
  '待交接': 'handoff',
  '已完成': 'done',
}

function useTasksContent(): string | null {
  const [content, setContent] = useState(context.tasksContent)
  useEffect(() => context.tasksEvents.on('change', setContent, true), [])
  return content
}

/**
 * 读最新文档后一次性写回：每个任务都要求当前仍处于 from（默认「待验证」），
 * 避免用户的操作覆盖 AI 在此期间写入的新状态。返回真正落盘的任务 id。
 */
async function commitTransitions(
  sandbox: TaskSandbox,
  taskPath: string,
  transitions: Array<{ id: string; target: TaskStatus; from?: TaskStatus }>,
): Promise<string[]> {
  const file = await sandbox.files.read(taskPath)
  if (!file) return []

  let content = file.content
  const applied: string[] = []
  for (const { id, target, from = '待验证' } of transitions) {
    const next = applyTaskTransition(content, id, target, { from })
    if (next !== content) {
      content = next
      applied.push(id)
    }
  }
  if (content !== file.content) await sandbox.files.write({ path: taskPath, content })
  return applied
}

function buildFeedbackMessage(items: Array<{ task: UserTaskInfo; reason: string }>): string {
  const lines = items.map(({ task, reason }, index) => {
    const title = task.title.replace(/[[\]]/g, ' ').trim()
    const head = `${index + 1}. [${title}](task://${task.id})`
    return reason ? `${head}\n   ${copy.feedbackReason()}：${reason}` : head
  })
  return `${copy.feedbackHeader()}\n\n${lines.join('\n')}`
}

const FAN_OFFSET_X = 8
const FAN_ROTATE = 3.2
const FAN_VISIBLE = 1

function getFanStyle(offset: number): React.CSSProperties {
  const abs = Math.abs(offset)
  if (abs > FAN_VISIBLE) {
    // 超出扇形可见范围的卡片收拢到边缘并隐藏，切换时有出入场过渡。
    return {
      zIndex: 0,
      opacity: 0,
      pointerEvents: 'none',
      transform: `translateX(${Math.sign(offset) * (FAN_VISIBLE + 1) * FAN_OFFSET_X}px) rotate(${Math.sign(offset) * (FAN_VISIBLE + 1) * FAN_ROTATE}deg) scale(.88)`,
    }
  }
  return {
    zIndex: 10 - abs,
    opacity: 1 - abs * 0.2,
    boxShadow: offset === 0 ? undefined : '0 1px 4px rgba(0, 0, 0, .08)',
    transform: `translateX(${offset * FAN_OFFSET_X}px) translateY(${abs * 2}px) rotate(${offset * FAN_ROTATE}deg) scale(${1 - abs * 0.04})`,
  }
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} />
    </svg>
  )
}

interface TaskOutcome {
  /** 处理时的任务快照；状态离开「待验证」后文档里的待验证列表不再包含它。 */
  task: UserTaskInfo
  status: TaskStatus
  reason?: string
  /** 不符合预期的反馈是否已经提交给 AI。 */
  submitted?: boolean
}

function TaskVerifyDeck({ comId, sandbox, taskPath, taskIds, onEmpty, related = false }: { comId: string; sandbox: TaskSandbox; taskPath: string; taskIds: string[]; onEmpty: () => void; related?: boolean }) {
  const content = useTasksContent()
  const tasks = useMemo(() => parseTasksForNotify(content ?? ''), [content])
  const relatedTasks = useMemo(() => {
    if (!related) return []
    const byId = new Map(tasks.map((task) => [task.id, task]))
    return taskIds.flatMap((id) => byId.get(id) ?? [])
  }, [tasks, related, taskIds])
  // 最近几轮关联的任务优先，其余待验证任务按文档顺序展示。
  const livePending = useMemo(() => {
    const pending = tasks.filter((task) => task.state === 1)
    const live = new Map(pending.map((task) => [task.id, task]))
    const priority = taskIds.flatMap((id) => live.get(id) ?? [])
    const priorityIds = new Set(taskIds)
    return related ? priority : [...priority, ...pending.filter((task) => !priorityIds.has(task.id))]
  }, [tasks, taskIds, related])

  const [outcomes, setOutcomes] = useState<Record<string, TaskOutcome>>({})
  const [active, setActive] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const pointerStartX = useRef<number | null>(null)
  const orderRef = useRef<string[]>([])

  // 展示列表 = 仍待验证的任务 + 本次已处理或暂存反馈的任务。
  // 已处理的卡片留在原位置，指示器据此区分「还没做」和「已经做了」；新出现的待验证任务排到最前。
  const items = useMemo(() => {
    const live = new Map(livePending.map((task) => [task.id, task]))
    // 任务重新回到待验证（AI 修复后再次提交验证）时，旧的处理结果作废。
    const effective = (id: string) => {
      const outcome = outcomes[id]
      return live.has(id) && outcome?.submitted ? undefined : outcome
    }
    const other = new Map(relatedTasks.filter((task) => task.state !== 1).map((task) => [task.id, task]))
    const kept = orderRef.current.filter((id) => live.has(id) || other.has(id) || effective(id))
    const fresh = (related ? relatedTasks : livePending).map((task) => task.id).filter((id) => !kept.includes(id))
    const order = [...fresh, ...kept]
    orderRef.current = order
    return order.map((id) => {
      const otherTask = other.get(id)
      const status: TaskStatus = otherTask?.state === 2 ? '待交接' : otherTask?.state === 3 ? '已完成' : '处理中'
      return { task: live.get(id) ?? otherTask ?? outcomes[id].task, outcome: effective(id) ?? (otherTask ? { task: otherTask, status, submitted: true } : undefined) }
    })
  }, [livePending, outcomes, related, relatedTasks])

  const remaining = items.filter((item) => !item.outcome).length
  const unsubmitted = items.filter((item) => item.outcome?.status === '待处理' && !item.outcome.submitted)
  const allHandled = items.length > 0 && remaining === 0

  const empty = !items.length && !busy
  useEffect(() => {
    if (empty && !related) onEmpty()
  }, [empty, onEmpty, related])

  // 全部处理完且没有待提交的反馈：停留片刻让用户看到结果，再把插槽还给 Sender。
  useEffect(() => {
    if (related || !allHandled || unsubmitted.length) return
    const timer = setTimeout(onEmpty, 1600)
    return () => clearTimeout(timer)
  }, [allHandled, unsubmitted.length, onEmpty, related])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(timer)
  }, [notice])

  const index = Math.min(active, Math.max(items.length - 1, 0))
  const go = useCallback((target: number) => {
    setActive(Math.max(0, Math.min(target, items.length - 1)))
  }, [items.length])

  const nextUnhandled = (fromIndex: number, excludeId: string) =>
    items.findIndex((item, i) => i > fromIndex && !item.outcome && item.task.id !== excludeId)

  const runTransition = async (
    task: UserTaskInfo,
    transition: { target: TaskStatus; from?: TaskStatus },
    onApplied: () => void,
  ) => {
    if (busy) return
    setBusy(true)
    try {
      const applied = await commitTransitions(sandbox, taskPath, [{ id: task.id, ...transition }])
      if (applied.length) onApplied()
      else setNotice(copy.outdated())
    } catch (error) {
      console.error('[mybricks][task-verify] transition failed', error)
      setNotice(copy.failed())
    } finally {
      setBusy(false)
    }
  }

  const handlePass = (task: UserTaskInfo) => {
    const status: TaskStatus = task.handoverTo ? '待交接' : '已完成'
    void runTransition(task, { target: status }, () => {
      setOutcomes((current) => ({ ...current, [task.id]: { task, status } }))
      const next = nextUnhandled(index, task.id)
      if (next >= 0) setActive(next)
    })
  }

  // 不符合预期：暂存任务与反馈，批量提交时再修改任务状态。
  const confirmReject = (task: UserTaskInfo) => {
    const reason = draft.trim()
    if (!reason || busy) return
    setOutcomes((current) => ({ ...current, [task.id]: { task, status: '待处理', reason } }))
    setEditingId(null)
    setDraft('')
    if (remaining === 1) {
      void submitFeedback([
        ...unsubmitted.map(({ task: pendingTask, outcome }) => ({ task: pendingTask, reason: outcome?.reason ?? '' })),
        { task, reason },
      ])
      return
    }
    const next = nextUnhandled(index, task.id)
    if (next >= 0) setActive(next)
  }

  const undoReject = (task: UserTaskInfo) => {
    setOutcomes((current) => {
      const { [task.id]: _removed, ...rest } = current
      return rest
    })
  }

  const submitFeedback = async (feedback: Array<{ task: UserTaskInfo; reason: string }>) => {
    if (busy || !feedback.length) return
    setBusy(true)
    try {
      const send = (window as any)._sandbox_?.helpers?.sendToAgent
      if (typeof send !== 'function') throw new Error('sendToAgent is unavailable')
      const ids = new Set(await commitTransitions(sandbox, taskPath, feedback.map(({ task }) => ({ id: task.id, target: '待处理' as TaskStatus }))))
      const submitted = feedback.filter(({ task }) => ids.has(task.id))
      if (submitted.length < feedback.length) setNotice(copy.outdated())
      if (!submitted.length) return
      send(comId, { message: buildFeedbackMessage(submitted) })
      setOutcomes((current) => Object.fromEntries(
        Object.entries(current).map(([id, outcome]) => [id, ids.has(id) ? { ...outcome, submitted: true } : outcome]),
      ))
    } catch (error) {
      console.error('[mybricks][task-verify] submit failed', error)
      setNotice(copy.failed())
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = () => {
    if (!allHandled) return
    void submitFeedback(unsubmitted.map(({ task, outcome }) => ({ task, reason: outcome?.reason ?? '' })))
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'TEXTAREA') return
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1) }
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    pointerStartX.current = (event.target as HTMLElement).closest('button, textarea') ? null : event.clientX
  }
  const handlePointerUp = (event: React.PointerEvent) => {
    const startX = pointerStartX.current
    pointerStartX.current = null
    if (startX === null) return
    const dx = event.clientX - startX
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1))
  }

  if (!items.length) return null

  return (
    <div className={[css['mb-tv'], related && css['mb-tv-related']].filter(Boolean).join(' ')}>
      <div className={css['mb-tv-head']}>
        <div className={css['mb-tv-title']}>
          <span>{related ? copy.relatedTitle() : remaining ? copy.title() : copy.allHandled()}</span>
          {notice ? <span className={css['mb-tv-notice']}>{notice}</span> : null}
        </div>
        {items.length > 1 ? (
          <div className={css['mb-tv-nav']}>
            <button type="button" className={css['mb-tv-icon-btn']} title={copy.prev()} disabled={index === 0} onClick={() => go(index - 1)}>
              <Chevron dir="left" />
            </button>
            <span className={css['mb-tv-nav-count']}>{index + 1} / {items.length}</span>
            <button type="button" className={css['mb-tv-icon-btn']} title={copy.next()} disabled={index === items.length - 1} onClick={() => go(index + 1)}>
              <Chevron dir="right" />
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={[css['mb-tv-deck'], items.length === 1 && css['is-single']].filter(Boolean).join(' ')}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {items.map(({ task, outcome }, i) => {
          const offset = i - index
          const isFront = offset === 0
          const isEditing = editingId === task.id
          const status: TaskStatus = outcome?.status === '待处理' && !outcome.submitted ? '待验证' : outcome?.status ?? '待验证'
          return (
            <div
              key={task.id}
              className={[css['mb-tv-card'], isFront ? css['is-front'] : css['is-behind'], outcome && css['is-handled']].filter(Boolean).join(' ')}
              style={getFanStyle(offset)}
              aria-hidden={!isFront}
              onClick={isFront ? undefined : () => go(i)}
            >
              <TaskCardHeading task={task} statusLabel={copy.status(status)} statusClass={STATUS_CLASS[status]} />

              {isEditing ? (
                <textarea
                  className={css['mb-tv-input']}
                  autoFocus
                  value={draft}
                  placeholder={copy.reasonPlaceholder()}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') { event.stopPropagation(); setEditingId(null) }
                  }}
                />
              ) : (
                <div className={css['mb-tv-verify']}>
                  <span className={css['mb-tv-verify-label']}>{copy.verification()}</span>
                  {task.verification || <span className={css['mb-tv-empty']}>{copy.noVerification()}</span>}
                </div>
              )}

              <div className={css['mb-tv-actions']}>
                {isEditing ? (
                  <>
                    <button type="button" className={css['mb-tv-btn']} disabled={busy} onClick={() => setEditingId(null)}>{copy.cancel()}</button>
                    <button type="button" className={[css['mb-tv-btn'], css['is-primary']].join(' ')} disabled={busy || !draft.trim()} onClick={() => confirmReject(task)}>{copy.confirm()}</button>
                  </>
                ) : outcome?.status === '待处理' ? (
                  <>
                    <span className={css['mb-tv-reason']} title={outcome.reason}>{outcome.reason || copy.noReason()}</span>
                    {outcome.submitted
                      ? <span className={css['mb-tv-hint']}>{copy.submittedHint()}</span>
                      : <button type="button" className={css['mb-tv-btn']} disabled={busy} onClick={() => undoReject(task)}>{copy.undo()}</button>}
                  </>
                ) : outcome ? (
                  outcome.status === '处理中' ? null : <span className={css['mb-tv-hint']}>{copy.passedHint()}</span>
                ) : (
                  <>
                    <button
                      type="button"
                      className={css['mb-tv-btn']}
                      disabled={!isFront || busy}
                      onClick={() => { setDraft(''); setEditingId(task.id) }}
                    >
                      {copy.reject()}
                    </button>
                    <button type="button" className={[css['mb-tv-btn'], css['is-primary']].join(' ')} disabled={!isFront || busy} onClick={() => handlePass(task)}>
                      {copy.pass()}
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {items.length > 1 ? (
        // 指示器：主题色 = 还没处理，灰色 = 已处理，拉长的一格 = 当前卡片。
        <div className={css['mb-tv-indicator']}>
          {items.map(({ task, outcome }, i) => (
            <button
              key={task.id}
              type="button"
              title={copy.goTo(i + 1)}
              className={[css['mb-tv-pip'], outcome ? css['is-done'] : css['is-todo'], i === index && css['is-current']].filter(Boolean).join(' ')}
              onClick={() => go(i)}
            />
          ))}
        </div>
      ) : null}

      {unsubmitted.length ? (
        <div className={css['mb-tv-bar']}>
          <span>{copy.barText(unsubmitted.length)}</span>
          <button type="button" className={[css['mb-tv-btn'], css['is-primary']].join(' ')} disabled={busy || !allHandled} onClick={handleSubmit}>{copy.submit()}</button>
        </div>
      ) : null}
    </div>
  )
}

/** 保留最近几轮的关联，供排序及后续按轮次展示使用。 */
const RECENT_TURNS = 3

interface TurnRecordLike {
  id: string
}

interface TurnLogEntry {
  turnId: string
  taskIds: string[]
}

function snapshotTasks(content: string | undefined): Map<string, string> {
  const result = new Map<string, string>()
  if (!content) return result
  const sections = content.split(/(?=^## )/m).filter((section) => section.startsWith('## '))
  for (const section of sections) {
    const task = parseTasksForNotify(section)[0]
    if (task?.state === 1) result.set(task.id, section)
  }
  return result
}

/** 创建任务验证能力，轮次关联和待办 UI 共享同一份状态。 */
export async function createTaskVerification({ comId, sandbox, taskPath }: { comId: string; sandbox: TaskSandbox; taskPath: string }) {
  let before = new Map<string, string>()
  let log: TurnLogEntry[] = []
  const listeners = new Set<() => void>()
  const storageKey = `mybricks-task-verify:${taskPath}`
  const taskIds = () => [...new Set(log.slice().reverse().flatMap((entry) => entry.taskIds.slice().reverse()))]

  try {
    const raw = localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) log = parsed.filter((entry) => entry && Array.isArray(entry.taskIds)).slice(-RECENT_TURNS)
  } catch (error) {
    console.warn('[mybricks][task-verify] restore turn associations failed', error)
  }
  try {
    const content = (await sandbox.files.read(taskPath))?.content ?? null
    context.setTasksContent(content)
    context.notifyUserTaskInfo(content === null ? [] : parseTasksForNotify(content))
  } catch (error) {
    context.setTasksContent(null)
    context.notifyUserTaskInfo([])
    console.warn('[mybricks][task-verify] restore pending area failed', error)
  }

  function TaskVerifyArea({ setActive }: { setActive: (active: boolean) => void }) {
    const content = useTasksContent()
    const [visible, setVisible] = useState(() => parseTasksForNotify(context.tasksContent ?? '').some((task) => task.state === 1))
    const [ids, setIds] = useState(taskIds)
    useEffect(() => {
      const update = () => setIds(taskIds())
      listeners.add(update)
      update()
      return () => { listeners.delete(update) }
    }, [])
    useEffect(() => {
      if (content === null) setVisible(false)
      else if (parseTasksForNotify(content).some((task) => task.state === 1)) setVisible(true)
    }, [content])
    useEffect(() => { setActive(visible) }, [setActive, visible])
    const close = useCallback(() => setVisible(false), [])
    return visible ? <TaskVerifyDeck comId={comId} sandbox={sandbox} taskPath={taskPath} taskIds={ids} onEmpty={close} /> : null
  }

  return {
    todoArea: TaskVerifyArea,
    async beforeTurn() {
      try {
        before = snapshotTasks((await sandbox.files.read(taskPath))?.content)
      } catch (error) {
        before = new Map()
        console.warn('[mybricks][task-verify] snapshot before turn failed', error)
      }
    },
    async afterTurn(turn: TurnRecordLike) {
      try {
        const after = snapshotTasks((await sandbox.files.read(taskPath))?.content)
        const ids = [...after].filter(([id, section]) => before.get(id) !== section).map(([id]) => id)
        log = [...log, { turnId: turn.id, taskIds: ids }].slice(-RECENT_TURNS)
        try { localStorage.setItem(storageKey, JSON.stringify(log)) } catch {}
        listeners.forEach((listener) => listener())
      } catch (error) {
        console.warn('[mybricks][task-verify] build pending area failed', error)
      }
    },
  }
}
