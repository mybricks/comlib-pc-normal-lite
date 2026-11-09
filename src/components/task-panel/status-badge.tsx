import React from 'react'
import { getLazyCss } from '../../mix/lowcodeView/utils/css'
import { i18n, type TaskStatus } from './index.i18n'
import * as lazyCss from './index.lazy.less'

const css = getLazyCss(lazyCss)
const STATUS_KIND: Record<TaskStatus, string> = {
  '处理中': 'progress',
  '待验证': 'verify',
  '待交接': 'handoff',
  '已完成': 'done',
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <span className={css['task-status-badge']} data-status={STATUS_KIND[status]}>{i18n.status(status)}</span>
}

export function TaskStatusDot({ status }: { status: TaskStatus }) {
  return <span className={css['flow-node-dot']} data-status={STATUS_KIND[status]} aria-hidden="true" />
}
