import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import context, { type UserTaskInfo } from '../context'
import commonLang from '../../helpers/i18n/common'
import { parseTasksForNotify } from './notify'
import { getTaskDisplayTitle, TaskCardHeading } from './task-card'
import css from './verify-block/index.less'

const TASK_STATE_LABEL: Record<UserTaskInfo['state'], string> = {
  0: '处理中',
  1: '待验证',
  2: '待交接',
  3: '已完成',
}

const TASK_STATE_CLASS: Record<UserTaskInfo['state'], string> = {
  0: 'doing',
  1: 'verify',
  2: 'handoff',
  3: 'done',
}

function TaskReferCard({ task }: { task: UserTaskInfo }) {
  const [hovered, setHovered] = useState(false)
  const [tasksContent, setTasksContent] = useState(context.tasksContent)
  const currentTask = parseTasksForNotify(tasksContent ?? '').find(item => item.id === task.id)

  const triggerRef = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState({ left: 8, top: 0 })
  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 276)),
      top: rect.top - 7,
    })
  }, [])

  useLayoutEffect(() => {
    if (!hovered) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [hovered, updatePosition])

  return (
    <span
      ref={triggerRef}
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'baseline' }}
      onMouseEnter={() => { setTasksContent(context.tasksContent); setHovered(true) }}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        style={{
          display: 'inline-flex',
          padding: '1px 6px',
          borderRadius: 4,
          background: 'var(--mybricks-bg-color-active, #e6f4ff)',
          color: 'var(--mybricks-color-primary, #1677ff)',
          cursor: 'default',
          fontWeight: 500,
        }}
      >
        <span>{commonLang.taskReferencePrefix}{getTaskDisplayTitle(currentTask?.title ?? task.title)}</span>
      </span>
      {hovered && currentTask && createPortal(
        <div
          role="tooltip"
          className={[css['mb-tv-card'], css['mb-tv-tooltip']].join(' ')}
          style={{
            // Portal 到 body 后不受聊天气泡、问答卡片和滚动容器的 overflow 约束。
            zIndex: 2147483647,
            top: position.top,
            left: position.left,
            transform: 'translateY(-100%)',
          }}
        >
          <TaskCardHeading task={currentTask} statusLabel={TASK_STATE_LABEL[currentTask.state] ?? '处理中'} statusClass={TASK_STATE_CLASS[currentTask.state] ?? TASK_STATE_CLASS[0]} />
          {currentTask.verification ? (
            <span style={{ display: 'block' }}>
              <span className={css['mb-tv-verify-label']}>验证条件：</span>
              <span className={css['mb-tv-tooltip-verification']}>{currentTask.verification}</span>
            </span>
          ) : null}
        </div>
      , document.body)}
    </span>
  )
}

/** 将 TASKS.md 的任务注册为 `task://<任务 ID>` 引用。 */
export function registerTaskReferResolver(sandboxAPI: any): void {
  if (typeof sandboxAPI?.registerRefer !== 'function') return

  sandboxAPI.registerRefer({
    scheme: 'task',
    resolve: async (id: string) => {
      const task = parseTasksForNotify(context.tasksContent ?? '').find((item) => item.id === id)
      return task ?? null
    },
    renderCard: (data: UserTaskInfo) => <TaskReferCard task={data} />,
  })
}
