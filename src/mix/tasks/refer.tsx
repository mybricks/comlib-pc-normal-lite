import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import context, { type UserTaskInfo } from '../context'
import commonLang from '../../helpers/i18n/common'
import { parseTasksForNotify } from './notify'

const TASK_STATE_LABEL: Record<UserTaskInfo['state'], string> = {
  0: '处理中',
  1: '待验证',
  2: '待交接',
  3: '已完成',
}

const TASK_STATE_STYLE: Record<UserTaskInfo['state'], { background: string; color: string }> = {
  0: { background: 'var(--mybricks-bg-color-active, #DFE1E6)', color: 'var(--mybricks-text-color-disabled, #42526E)' },
  1: { background: '#ff4d4f', color: '#fff' },
  2: { background: '#faad14', color: '#fff' },
  3: { background: '#52c41a', color: '#fff' },
}

function getTaskDisplayTitle(title: string): string {
  return title.replace(/^T-\d+\s*[-:：]?\s*/, '') || title
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
        <span
          role="tooltip"
          style={{
            // Portal 到 body 后不受聊天气泡、问答卡片和滚动容器的 overflow 约束。
            position: 'fixed',
            zIndex: 2147483647,
            top: position.top,
            left: position.left,
            transform: 'translateY(-100%)',
            width: 260,
            padding: '9px 10px',
            border: '1px solid var(--mybricks-border-color-main, #d9d9d9)',
            borderRadius: 6,
            background: 'var(--mybricks-bg-color-main, #fff)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.14)',
            color: 'var(--mybricks-text-color-main, #1f1f1f)',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.5,
            pointerEvents: 'none',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: currentTask.desc || currentTask.verification ? 6 : 0 }}>
            <span style={{ flexShrink: 0, fontSize: 11, padding: '1px 5px', borderRadius: 2, fontWeight: 500, lineHeight: '16px', ...(TASK_STATE_STYLE[currentTask.state] ?? TASK_STATE_STYLE[0]) }}>
              {TASK_STATE_LABEL[currentTask.state] ?? '处理中'}
            </span>
            <strong style={{ minWidth: 0, fontSize: 13, fontWeight: 600, lineHeight: '18px', overflowWrap: 'anywhere' }}>{getTaskDisplayTitle(currentTask.title)}</strong>
          </span>
          {currentTask.desc ? <span style={{ display: 'block', marginBottom: currentTask.verification ? 6 : 0, color: 'var(--mybricks-text-color-disabled, #8c8c8c)', overflowWrap: 'anywhere' }}>{currentTask.desc}</span> : null}
          {currentTask.verification ? (
            <span style={{ display: 'block' }}>
              <b style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>验证条件：</b>
              <span style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{currentTask.verification}</span>
            </span>
          ) : null}
        </span>
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
