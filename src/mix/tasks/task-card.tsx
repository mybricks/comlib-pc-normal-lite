import React from 'react'
import type { UserTaskInfo } from '../context'
import css from './verify-block/index.less'

export function getTaskDisplayTitle(title: string): string {
  return title.replace(/^T-\d+\s*[-:：]?\s*/, '') || title
}

/** 引用卡片和验证卡片共用的标题、状态标签及需求描述。 */
export function TaskCardHeading({ task, statusLabel, statusClass }: {
  task: UserTaskInfo
  statusLabel: string
  statusClass: string
}) {
  return (
    <>
      <div className={css['mb-tv-card-head']}>
        <span className={[css['mb-tv-tag'], css[`status-${statusClass}`]].join(' ')}>{statusLabel}</span>
        <span className={css['mb-tv-card-title']} title={task.title}>{getTaskDisplayTitle(task.title)}</span>
      </div>
      {task.desc ? <div className={css['mb-tv-desc']} title={task.desc}>{task.desc}</div> : null}
    </>
  )
}
