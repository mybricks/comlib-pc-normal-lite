import React, { useState, useEffect, useRef } from 'react'
import context from '../../mix/context'
import { randomUUID } from '../../mix/utils/uuid'
import { getLazyCss } from '../../mix/lowcodeView/utils/css'
import i18n from '../../helpers/i18n'
import { findTaskDocumentFile } from '../../mix/tasks/notify'
import { applyTaskTransition } from '../../mix/tasks/transition'
import { Popconfirm } from '../version-list'
import * as lazyCss from './index.lazy.less'

const css = getLazyCss(lazyCss)

function useDismissOnOutsideClick(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onDismiss()
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onDismiss])

  return ref
}

function TaskActionHint({
  message,
  className,
  onClose,
}: {
  message: string
  className: string
  onClose: () => void
}) {
  const hintRef = useDismissOnOutsideClick(onClose)

  return (
    <div ref={hintRef} className={className} role="status">
      <span>{message}</span>
      <button
        type="button"
        className={css['task-action-hint-close']}
        aria-label={taskPanelCopy.closeHint()}
        onClick={(e) => { e.stopPropagation(); onClose() }}
      >
        ×
      </button>
    </div>
  )
}

type TaskStatus = '处理中' | '待验证' | '待交接' | '已完成'
interface TaskMetadata {
  label: string
  value: string
}
interface TaskItem {
  id?: string
  title: string
  status: TaskStatus
  updatedAt?: string
  updatedAtTimestamp?: number
  handoverTo?: string
  handoverReason?: string
  verificationCondition?: string
  metadata: TaskMetadata[]
  summary?: string
  detail?: string
}

interface FlowStep {
  status: string
  dot: string
  count: number
  disabled: boolean
}

const TASK_FLOW_ORDER: TaskStatus[] = ['处理中', '待验证', '待交接', '已完成']

// TASKS.md 的解析约定仍使用中文字段和值；这里只转换 Task Panel 可见的 UI 文案。
const taskPanelCopy = {
  closeHint: () => i18n({ zh: '关闭提示', en: 'Dismiss hint' }),
  all: () => i18n({ zh: '全部', en: 'All' }),
  noItems: () => i18n({ zh: '暂无', en: 'None' }),
  selected: (count: number) => i18n({ zh: `已选 ${count} 项`, en: `${count} selected` }),
  adjust: () => i18n({ zh: '调整', en: 'Update' }),
  noSharedAction: () => i18n({ zh: '无共同可执行操作', en: 'No shared action' }),
  clearSelection: () => i18n({ zh: '取消选择', en: 'Clear selection' }),
  batchDisabled: () => i18n({ zh: '任务数量不足，无法批量调整', en: 'Select at least two tasks to batch update' }),
  batchUpdate: () => i18n({ zh: '批量调整任务状态', en: 'Batch update task status' }),
  batchUpdateShort: () => i18n({ zh: '批量调整', en: 'Batch update' }),
  verification: () => i18n({ zh: '验证条件', en: 'Verification' }),
  handoverTo: () => i18n({ zh: '交接给', en: 'Handover to' }),
  addToChat: () => i18n({ zh: '添加到对话', en: 'Add to chat' }),
  deleteTask: () => i18n({ zh: '删除此任务', en: 'Delete task' }),
  deleteConfirm: () => i18n({ zh: '删除后任务和相关修改都会被删除，确认让 AI 删除此任务？', en: 'Delete this task and its related changes?' }),
  sameStatusOnly: () => i18n({ zh: '只能同时选择相同状态的任务', en: 'Only tasks with the same status can be selected together' }),
  collapseDetails: () => i18n({ zh: '收起详情', en: 'Hide details' }),
  expandDetails: () => i18n({ zh: '展开详情', en: 'Show details' }),
  noResults: () => i18n({ zh: '无匹配结果', en: 'No matching tasks' }),
  addedToChat: () => i18n({ zh: '已添加到对话输入框', en: 'Added to chat input' }),
  addedToChatWithReason: () => i18n({ zh: '已添加到对话输入框，请补充原因后发送', en: 'Added to chat input. Add a reason before sending.' }),
  handedToAI: () => i18n({ zh: '已交给 AI 处理', en: 'Sent to AI' }),
  statusUpdated: () => i18n({ zh: '已更新任务状态', en: 'Task status updated' }),
  statusUpdateFailed: () => i18n({ zh: '任务状态更新失败，请重试', en: 'Failed to update task status. Please try again.' }),
  reasonPrompt: () => i18n({ zh: '请填写原因', en: 'Please provide a reason' }),
  transitionReady: () => i18n({ zh: '代码已完成，等待我验证', en: 'Code complete, ready for verification' }),
  transitionVerified: () => i18n({ zh: '已验证完成', en: 'Verification passed' }),
  transitionNeedsFix: () => i18n({ zh: '任务有问题，请重新修改', en: 'Needs revision' }),
  attentionTitle: () => i18n({ zh: '点击查看待验证任务', en: 'View tasks awaiting verification' }),
  attentionBefore: (count: number) => i18n({ zh: `有 ${count} 个任务已经改完了，需要您帮忙验证下结果，如果没问题可以`, en: `${count} task${count === 1 ? '' : 's'} need verification. If everything looks right,` }),
  attentionLink: () => i18n({ zh: '告知我', en: 'tell me' }),
  attentionAfter: () => i18n({ zh: '结果', en: ' the result.' }),
  attentionLinkTitle: () => i18n({ zh: '打开对话，告知我结果', en: 'Open chat and tell me the result' }),
  status: (status: TaskStatus) => {
    const copy: Record<TaskStatus, { zh: string; en: string }> = {
      '处理中': { zh: '处理中', en: 'In progress' },
      '待验证': { zh: '待验证', en: 'Needs verification' },
      '待交接': { zh: '待交接', en: 'Pending handover' },
      '已完成': { zh: '已完成', en: 'Completed' },
    }
    return i18n(copy[status])
  },
  metadataLabel: (label: string) => {
    const copy: Record<string, { zh: string; en: string }> = {
      '更新时间': { zh: '更新时间', en: 'Updated' },
      '交接给': { zh: '交接给', en: 'Handover to' },
      '交接原因': { zh: '交接原因', en: 'Handover reason' },
      '验证进展': { zh: '验证进展', en: 'Verification progress' },
    }
    return copy[label] ? i18n(copy[label]) : label
  },
}

const TASK_STATUS_STYLE: Record<string, { dot: string; badgeBg: string; badgeText: string }> = {
  '处理中': {
    dot: 'var(--mybricks-text-color-disabled, #ccc)',
    badgeBg: 'var(--mybricks-bg-color-active, #DFE1E6)',
    badgeText: 'var(--mybricks-text-color-disabled, #42526E)',
  },
  '待验证': {
    dot: '#ff4d4f',
    badgeBg: '#ff4d4f',
    badgeText: '#fff',
  },
  '待交接': {
    dot: '#faad14',
    badgeBg: '#faad14',
    badgeText: '#fff',
  },
  '已完成': {
    dot: '#52c41a',
    badgeBg: '#52c41a',
    badgeText: '#fff',
  },
}

function extractMetaField(section: string, fieldName: string): string | undefined {
  return extractMetadata(section).find((item) => item.label === fieldName)?.value
}

function extractSummary(section: string): string | undefined {
  const lines = section.split('\n')
  const summaryLines: string[] = []
  for (const line of lines) {
    const m = line.match(/^>\s*(.*)/)
    if (m) {
      const text = m[1].trim()
      if (text) summaryLines.push(text)
    }
  }
  return summaryLines.length ? summaryLines.join(' ') : undefined
}

function isVerificationConditionHeading(line: string): boolean {
  const normalized = line.replace(/[*_`]/g, '')
  // task-first 约定为单独一行 `**验证条件**：`，后面跟编号列表；
  // 同时兼容旧的 Markdown 小节与列表字段写法。
  return /^\s*(?:(?:#{2,4}\s+)|(?:-\s*))?验证条件\s*[：:]?\s*$/.test(normalized)
}

function isMetadataLine(line: string): boolean {
  const normalized = line.replace(/[*_`]/g, '')
  return /^\s*-\s*[^：:]+[：:]\s*\S/.test(normalized)
}

function extractDetail(section: string): string | undefined {
  const lines = section.split('\n')
  let passedTitle = false
  let skippingVerification = false
  const detailLines: string[] = []

  for (const line of lines) {
    if (!passedTitle) {
      if (/^#+\s/.test(line)) passedTitle = true
      continue
    }
    if (isVerificationConditionHeading(line)) {
      skippingVerification = true
      continue
    }
    if (skippingVerification) {
      if (/^\s*#{1,4}\s+/.test(line) || isMetadataLine(line)) {
        skippingVerification = false
      } else {
        continue
      }
    }
    if (isMetadataLine(line)) continue
    if (/^>\s*/.test(line)) continue
    detailLines.push(line)
  }

  const detail = detailLines.join('\n').trim()
  return detail || undefined
}

function splitSections(content: string): string[] {
  // 一个任务由 `## T-xxx` 开始，后续 `### 验证条件` 等子标题仍属于同一任务；
  // 不能按所有 Markdown 标题切开，否则验证条件会脱离对应任务而无法常驻展示。
  return content.split(/(?=^##\s)/m).filter(s => /^##\s/.test(s))
}

function extractMetadata(section: string): TaskMetadata[] {
  const metadata: TaskMetadata[] = []
  for (const line of section.split('\n')) {
    const normalized = line.replace(/[*_`]/g, '')
    const match = normalized.match(/^\s*-\s*([^：:\n]+?)\s*[：:]\s*(.+)$/)
    if (!match) continue
    const label = match[1].trim()
    const value = match[2].trim()
    if (label && value) metadata.push({ label, value })
  }
  return metadata
}

/** 验证条件必须常驻展示，兼容单行字段、字段后的 bullet 列表和 Markdown 小节。 */
function extractVerificationCondition(section: string): string | undefined {
  const inline = extractMetaField(section, '验证条件')
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
    // 这里只识别区块边界，区块正文不作任何格式假设或转换。
    values.push(line)
  }
  const content = values.join('\n').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')
  return content || undefined
}

function normalizeTaskStatus(raw: string | undefined): TaskStatus {
  const status = raw?.replace(/[*_`]/g, '').trim() || '处理中'
  if (status === '待处理') return '处理中'
  if (status === '待验收') return '待验证'
  return ['处理中', '待验证', '待交接', '已完成'].includes(status)
    ? status as TaskStatus
    : '处理中'
}

function parseTaskUpdatedAt(raw: string | undefined): number | undefined {
  if (!raw) return undefined

  const timestamp = new Date(raw.trim()).getTime()
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function parseTasks(content: string): TaskItem[] {
  const tasks: TaskItem[] = []
  const sections = splitSections(content)
  for (const section of sections) {
    const title = section.split('\n')[0].replace(/^#+\s*/, '').trim()
    if (!title) continue
    const id = title.match(/^(T-\d+)\b/)?.[1]
    const metadata = extractMetadata(section)
    const updatedAt = metadata.find(item => item.label === '更新时间')?.value
    const handoverTo = metadata.find(item => item.label === '交接给')?.value
    const handoverReason = metadata.find(item => item.label === '交接原因')?.value
    const verificationCondition = extractVerificationCondition(section)
    tasks.push({
      id,
      title,
      status: normalizeTaskStatus(extractMetaField(section, '状态')),
      updatedAt,
      updatedAtTimestamp: parseTaskUpdatedAt(updatedAt),
      handoverTo,
      handoverReason,
      verificationCondition,
      metadata: metadata.filter(item => item.label !== '状态' && item.label !== '交接给' && item.label !== '交接原因' && item.label !== '验证条件'),
      summary: extractSummary(section),
      detail: extractDetail(section),
    })
  }
  return tasks
}

export function hasTasks(content: string | null): boolean {
  return Boolean(content && parseTasks(content).length)
}


function FlowArrow() {
  return (
    <svg className={css['flow-arrow']} width="14" height="10" viewBox="0 0 14 10" fill="none">
      <path d="M1 5H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="2 2" />
      <path d="M8.5 2L11.5 5L8.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const ATTENTION_STATUS = '待验证'

function FlowFilterBar({
  steps,
  total,
  activeFilter,
  onFilter,
  updatedAt,
  batchMode,
  batchDisabled,
  onToggleBatchMode,
  selectedCount,
  batchTransitions,
  onBatchAction,
  onClearSelection,
}: {
  steps: FlowStep[]
  total: number
  activeFilter: string | null
  onFilter: (s: string | null) => void
  updatedAt: string | null
  batchMode: boolean
  batchDisabled: boolean
  onToggleBatchMode: () => void
  selectedCount: number
  batchTransitions: TaskTransition[]
  onBatchAction: (transition: TaskTransition) => void
  onClearSelection: () => void
}) {
  return (
    <div className={css['summary-bar']}>
      <div className={css['flow-track']}>
        <div
          className={`${css['flow-node']} ${css['flow-node-all']} ${!activeFilter ? css['flow-node-active'] : ''}`}
          onClick={() => onFilter(null)}
          title={taskPanelCopy.all()}
        >
          <span className={css['flow-node-label']}>{taskPanelCopy.all()}</span>
          <span className={css['flow-node-count']}>{total}</span>
        </div>
        {steps.map(step => {
          return (
            <React.Fragment key={step.status}>
              <FlowArrow />
              <div
                className={[
                  css['flow-node'],
                  activeFilter === step.status ? css['flow-node-active'] : '',
                  step.disabled ? css['flow-node-disabled'] : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onFilter(activeFilter === step.status ? null : step.status)}
                title={step.disabled ? `${taskPanelCopy.status(step.status as TaskStatus)} (${taskPanelCopy.noItems()})` : taskPanelCopy.status(step.status as TaskStatus)}
              >
                <span className={css['flow-node-dot']} style={{ background: step.dot }} />
                <span className={css['flow-node-label']}>{taskPanelCopy.status(step.status as TaskStatus)}</span>
                <span className={css['flow-node-count']}>{step.count}</span>
              </div>
            </React.Fragment>
          )
        })}
      </div>
      {updatedAt && (
        <span className={css['summary-updated-at']}>{updatedAt}</span>
      )}
      {batchMode ? (
        <div className={css['batch-toolbar']}>
          <span className={css['batch-toolbar-count']}>{taskPanelCopy.selected(selectedCount)}</span>
          {batchTransitions.length > 0 ? (
            <div className={css['task-status-selector']}>
              <span className={css['task-status-selector-text']}>{taskPanelCopy.adjust()}</span>
              <DownChevronIcon />
              <select
                className={css['task-status-select-overlay']}
                value=""
                onChange={(e) => {
                  const transition = batchTransitions.find(item => item.target === e.target.value)
                  if (transition) onBatchAction(transition)
                  e.currentTarget.value = ''
                }}
              >
                <option value="" disabled>{taskPanelCopy.adjust()}</option>
                {batchTransitions.map(transition => (
                  <option key={transition.target} value={transition.target}>{transition.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <span className={css['batch-toolbar-empty']}>{taskPanelCopy.noSharedAction()}</span>
          )}
          <span className={css['batch-toolbar-clear']} onClick={onClearSelection}>{taskPanelCopy.clearSelection()}</span>
        </div>
      ) : (
        <span
          className={[
            css['batch-toggle-btn'],
            batchDisabled ? css['batch-toggle-btn-disabled'] : '',
          ].filter(Boolean).join(' ')}
          onClick={() => { if (!batchDisabled) onToggleBatchMode() }}
          title={batchDisabled ? taskPanelCopy.batchDisabled() : taskPanelCopy.batchUpdate()}
        >
          {taskPanelCopy.batchUpdateShort()}
        </span>
      )}
    </div>
  )
}

function AttentionHint({
  steps,
  onClick,
  onHoverChange,
}: {
  steps: FlowStep[]
  onClick: () => void
  onHoverChange: (hovering: boolean) => void
}) {
  const count = steps.find(step => step.status === ATTENTION_STATUS)?.count ?? 0
  if (!count) return null

  const handleTellMe = (e: React.MouseEvent) => {
    e.stopPropagation()
    const appendToSender = (window as any)._sandbox_?.helpers?.appendToSender
    const componentId = context.comId ?? context.component?.params?.id
    if (typeof appendToSender === 'function' && componentId) {
      ;(context.plugins as any)?.showAIDialog?.()
      appendToSender(componentId, {
        message: '',
        mentionFocus: true,
        attachments: [],
      })
      return
    }
    ;(context.plugins as any)?.showAIDialog?.()
  }

  return (
    <div
      className={css['attention-hint']}
      onClick={onClick}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      title={taskPanelCopy.attentionTitle()}
    >
      <span className={css['attention-hint-text']}>
        {taskPanelCopy.attentionBefore(count)}
      </span>
      <span className={css['attention-hint-link']} onClick={handleTellMe} title={taskPanelCopy.attentionLinkTitle()}>
        {taskPanelCopy.attentionLink()}
      </span>
      <span className={css['attention-hint-text']}>{taskPanelCopy.attentionAfter()}</span>
    </div>
  )
}


function DetailContent({ detail }: { detail: string }) {
  return (
    <div className={css['detail-content']}>
      {detail.split('\n').map((line, i) => {
        const headingMatch = line.match(/^#{2,4}\s+(.+)/)
        if (headingMatch) {
          return <div key={i} className={css['detail-heading']}>{headingMatch[1].replace(/[*_`]/g, '')}</div>
        }
        const bulletMatch = line.match(/^\s*[-*]\s+(.+)/)
        if (bulletMatch) {
          return (
            <div key={i} className={css['detail-bullet']}>
              <span className={css['detail-bullet-dot']} />
              {bulletMatch[1].replace(/[*_`]/g, '')}
            </div>
          )
        }
        if (!line.trim()) {
          return <div key={i} className={css['detail-gap']} />
        }
        return <div key={i} className={css['detail-text']}>{line.replace(/[*_`]/g, '')}</div>
      })}
    </div>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`${css['chevron']} ${expanded ? css['chevron-expanded'] : ''}`}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
    >
      <path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14c0-2.5 2.5-4 5.5-4s5.5 1.5 5.5 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  )
}

function DownChevronIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ pointerEvents: 'none', flexShrink: 0 }}>
      <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AtIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M13.106 7.222c0-2.967-2.249-5.032-5.482-5.032-3.35 0-5.646 2.318-5.646 5.702 0 3.493 2.235 5.708 5.762 5.708.862 0 1.689-.123 2.304-.335v-.862c-.43.199-1.354.328-2.29.328-2.926 0-4.813-1.88-4.813-4.798 0-2.844 1.921-4.881 4.594-4.881 2.735 0 4.608 1.688 4.608 4.156 0 1.682-.554 2.769-1.416 2.769-.492 0-.772-.28-.772-.76V5.206H8.923v.834h-.11c-.266-.595-.881-.964-1.6-.964-1.4 0-2.378 1.162-2.378 2.823 0 1.737.957 2.906 2.379 2.906.8 0 1.415-.39 1.709-1.087h.11c.081.67.703 1.148 1.503 1.148 1.572 0 2.57-1.415 2.57-3.643zm-7.177.704c0-1.197.54-1.907 1.456-1.907.93 0 1.524.738 1.524 1.907S8.308 9.84 7.371 9.84c-.895 0-1.442-.725-1.442-1.914z" />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
    </svg>
  )
}

interface TaskTransition {
  target: TaskStatus
  label: string
  instruction: string
  requiresReason?: boolean
}

async function commitTaskTransition(taskId: string, targetStatus: TaskStatus): Promise<boolean> {
  const sandboxHelpers = (window as any)._sandbox_?.helpers
  if (typeof sandboxHelpers?.updateFiles !== 'function') return false

  const files = (context.component?.params?.data?.files) ?? []
  const configured = (window as any).__LINGCHUANG_CONFIG__?.configDirName
    ?? (window as any)._sandbox_?.config?.configDirName
  const file = findTaskDocumentFile(files, { configDirName: configured, fallbackRoot: '.agent' })
  if (!file?.fileName || !file.source) return false

  let content: string
  try {
    content = decodeURIComponent(file.source)
  } catch {
    content = file.source
  }
  // Do not update a different or stale document than the one shown in the panel.
  if (content !== context.tasksContent) return false

  const updated = applyTaskTransition(content, taskId, targetStatus)
  if (updated === content) return false

  await sandboxHelpers.updateFiles([{ path: file.fileName, content: updated }])
  return true
}

function sendTaskMessage(message: string) {
  const componentId = context.comId ?? context.component?.params?.id
  const sendToAgent = (window as any)._sandbox_?.helpers?.sendToAgent

  if (typeof sendToAgent === 'function' && componentId) {
    sendToAgent(componentId, { message })
    return
  }

  const plugins = context.plugins as any
  plugins?.showAIDialog?.()
  plugins?.aiService?.request({
    message,
    attachments: [],
  })
}

function getTaskTransitions(task: TaskItem): TaskTransition[] {
  const transitions: Record<TaskStatus, TaskTransition[]> = {
    '处理中': [{
      target: '待验证',
      label: taskPanelCopy.transitionReady(),
      instruction: '代码已完成，等待我验证',
      requiresReason: true,
    }],
    '待验证': [
      {
        target: '已完成',
        label: taskPanelCopy.transitionVerified(),
        instruction: '已验证完成',
      },
      {
        target: '处理中',
        label: taskPanelCopy.transitionNeedsFix(),
        instruction: '任务有问题，请重新修改',
        requiresReason: true,
      },
    ],
    '待交接': [
      {
        target: '处理中',
        label: taskPanelCopy.transitionNeedsFix(),
        instruction: '任务有问题，请重新修改',
        requiresReason: true,
      },
    ],
    '已完成': [
      {
        target: '处理中',
        label: taskPanelCopy.transitionNeedsFix(),
        instruction: '任务有问题，请重新修改',
        requiresReason: true,
      },
    ],
  }

  if (task.status === '待验证' && task.handoverTo) {
    return [
      {
        target: '待交接',
        label: taskPanelCopy.transitionVerified(),
        instruction: '已验证完成',
      },
      ...transitions['待验证'].filter(item => item.target !== '已完成'),
    ]
  }
  return transitions[task.status]
}

function CheckboxIcon({ checked }: { checked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="3"
        fill={checked ? 'var(--mybricks-color-primary, #1677ff)' : 'transparent'}
        stroke={checked ? 'var(--mybricks-color-primary, #1677ff)' : 'var(--mybricks-text-color-disabled, #c1c7d0)'}
        strokeWidth="1.5"
      />
      {checked && (
        <path d="M4.5 8.2L6.8 10.5L11.5 5.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

function TaskRow({
  task,
  highlightProgress,
  batchMode,
  selectable,
  selected,
  allowDelete,
  onToggleSelect,
}: {
  task: TaskItem
  highlightProgress?: boolean
  batchMode?: boolean
  selectable?: boolean
  selected?: boolean
  allowDelete?: boolean
  onToggleSelect?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [revertConfirmVisible, setRevertConfirmVisible] = useState(false)
  const [actionHint, setActionHint] = useState<string | null>(null)
  const style = TASK_STATUS_STYLE[task.status] ?? TASK_STATUS_STYLE['处理中']
  const displayTitle = task.id ? task.title.slice(task.id.length).replace(/^\s*[-:：]?\s*/, '') || task.title : task.title
  const hasDetail = !!task.detail
  const transitions = getTaskTransitions(task)

  const handleAddToChat = (e: React.MouseEvent) => {
    e.stopPropagation()
    const appendToSender = (window as any)._sandbox_?.helpers?.appendToSender
    const componentId = context.comId ?? context.component?.params?.id
    if (typeof appendToSender === 'function' && componentId) {
      ;(context.plugins as any)?.showAIDialog?.()
      const chip = {
        id: randomUUID(),
        type: 'task',
        label: task.title,
        data: { title: task.title },
      }
      appendToSender(componentId, {
        message: `[[chip:${chip.id}]]`,
        meta: { chips: [chip] },
        animation: true,
      })
      setActionHint(taskPanelCopy.addedToChat())
      return
    }
    ;(context.plugins as any)?.showAIDialog?.()
  }

  const handleRevert = () => {
    sendTaskMessage(`[$mbs-template:revoke-task] 删除任务「${task.title}」及其相关修改`)
    setActionHint(taskPanelCopy.handedToAI())
  }

  const handleTransition = async (transition: TaskTransition) => {
    const message = `任务「${task.title}」：${transition.instruction}`

    if (transition.requiresReason) {
      const appendToSender = (window as any)._sandbox_?.helpers?.appendToSender
      const componentId = context.comId ?? context.component?.params?.id
      const requestPayload = {
        message: `${message}\n\n原因：`,
        mentionFocus: true,
        attachments: [],
      }

      if (typeof appendToSender === 'function' && componentId) {
        ;(context.plugins as any)?.showAIDialog?.()
        appendToSender(componentId, requestPayload)
        setActionHint(taskPanelCopy.addedToChatWithReason())
        return
      }

      const reason = window.prompt(taskPanelCopy.reasonPrompt())?.trim()
      if (!reason) return
      sendTaskMessage(`${message}\n\n原因：${reason}`)
      setActionHint(taskPanelCopy.handedToAI())
      return
    }

    try {
      if (task.id && await commitTaskTransition(task.id, transition.target)) {
        setActionHint(taskPanelCopy.statusUpdated())
        return
      }
    } catch (error) {
      console.error('Failed to update task status:', error)
      setActionHint(taskPanelCopy.statusUpdateFailed())
      return
    }

    sendTaskMessage(message)
    setActionHint(taskPanelCopy.handedToAI())
  }

  return (
    <div
      className={[
        css['task-card'],
        selected ? css['task-card-selected'] : '',
        batchMode ? css['task-card-batch-mode'] : '',
        batchMode && !selectable ? css['task-card-batch-disabled'] : '',
        actionHint ? css['task-card-has-hint'] : '',
      ].filter(Boolean).join(' ')}
      onClick={() => { if (batchMode && selectable) onToggleSelect?.() }}
    >
      <div className={css['task-card-header']}>
        <div className={css['task-card-header-main']}>
          {batchMode && (
            <span
              className={`${css['task-checkbox']} ${!selectable ? css['task-checkbox-disabled'] : ''}`}
              onClick={(e) => { e.stopPropagation(); if (selectable) onToggleSelect?.() }}
              title={selectable ? undefined : taskPanelCopy.sameStatusOnly()}
            >
              <CheckboxIcon checked={!!selected} />
            </span>
          )}
          <span
            className={css['task-status-badge']}
            style={{ background: style.badgeBg, color: style.badgeText }}
          >
            {taskPanelCopy.status(task.status)}
          </span>
          <span className={css['task-title']} title={displayTitle}>{displayTitle}</span>
          {task.handoverTo && (
            <span className={css['task-handover-inline']}>
              <span className={css['task-handover-label']}>{taskPanelCopy.handoverTo()}</span>
              <UserIcon />
              <span className={css['task-handover-name']}>{task.handoverTo}</span>
              {task.handoverReason && (
                <span className={css['task-handover-tooltip']}>{task.handoverReason}</span>
              )}
            </span>
          )}
        </div>
        <div className={css['task-card-actions']}>
          <span
            className={css['task-action-icon']}
            data-mybricks-tip={taskPanelCopy.addToChat()}
            onClick={handleAddToChat}
          >
            <AtIcon />
          </span>
          {allowDelete && (
            <Popconfirm
              title={taskPanelCopy.deleteConfirm()}
              visible={revertConfirmVisible}
              onVisible={setRevertConfirmVisible}
              onConfirm={handleRevert}
            >
              <span
                className={css['task-action-icon']}
                data-mybricks-tip={taskPanelCopy.deleteTask()}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              >
                <DeleteIcon />
              </span>
            </Popconfirm>
          )}
          {transitions.length > 0 && (
            <div className={css['task-status-selector']}>
              <span className={css['task-status-selector-text']}>{taskPanelCopy.adjust()}</span>
              <DownChevronIcon />
              <select
                className={css['task-status-select-overlay']}
                value=""
                onChange={(e) => {
                  const transition = transitions.find(item => item.target === e.target.value)
                  if (transition) handleTransition(transition)
                  e.currentTarget.value = ''
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="" disabled>{taskPanelCopy.adjust()}</option>
                {transitions.map(transition => (
                  <option key={transition.target} value={transition.target}>{transition.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {actionHint && (
        <TaskActionHint
          message={actionHint}
          className={css['task-row-action-hint']}
          onClose={() => setActionHint(null)}
        />
      )}

      {task.summary && (
        <div className={css['task-summary']}>{task.summary}</div>
      )}

      {(task.verificationCondition || task.metadata.length > 0) && (
        <div className={css['task-meta-list']}>
          {task.verificationCondition && (
            <div className={`${css['task-meta-item']} ${css['task-verification']} ${highlightProgress ? css['task-meta-item-highlight'] : ''}`}>
              <span className={css['task-meta-label']}>{taskPanelCopy.verification()}</span>
              <span className={css['task-meta-value']}>{task.verificationCondition}</span>
            </div>
          )}
          {task.metadata.map((item) => {
            const isProgress = item.label === '验证进展'
            const hl = isProgress && highlightProgress
            return (
              <div
                key={item.label}
                className={`${css['task-meta-item']} ${hl ? css['task-meta-item-highlight'] : ''}`}
              >
                <span className={css['task-meta-label']}>{taskPanelCopy.metadataLabel(item.label)}</span>
                <span className={css['task-meta-value']}>{item.value}</span>
              </div>
            )
          })}
        </div>
      )}

      {hasDetail && (
        <div className={css['task-detail-toggle']} onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}>
          <ChevronIcon expanded={expanded} />
          <span>{expanded ? taskPanelCopy.collapseDetails() : taskPanelCopy.expandDetails()}</span>
        </div>
      )}

      {hasDetail && expanded && (
        <div className={css['task-detail-wrapper']}>
          <DetailContent detail={task.detail!} />
        </div>
      )}
    </div>
  )
}

function getSharedTransitions(tasks: TaskItem[]): TaskTransition[] {
  if (!tasks.length) return []
  const [first, ...rest] = tasks.map(t => getTaskTransitions(t))
  return rest.reduce(
    (acc, cur) => acc.filter(t => cur.some(c => c.target === t.target)),
    first
  )
}

function TaskPanel({ content, allowDelete = false }: { content: string | null, allowDelete?: boolean }) {
  const [filter, setFilter] = useState<string | null>(null)
  const [hintHovering, setHintHovering] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [actionHint, setActionHint] = useState<string | null>(null)

  useEffect(() => {
    setFilter(null)
    setBatchMode(false)
    setSelected(new Set())
  }, [content])

  const tasks = content ? parseTasks(content) : []
  if (!tasks.length) return null

  const selectedTasks = tasks.filter(t => selected.has(t.id ?? t.title))
  const selectedStatus = selectedTasks[0]?.status ?? null
  // 批量操作只支持无需填写原因的目标状态，需要补充原因的场景仍走单任务交互
  const sharedTransitions = getSharedTransitions(selectedTasks).filter(t => !t.requiresReason)

  const exitBatchMode = () => {
    setBatchMode(false)
    setSelected(new Set())
  }

  const toggleBatchMode = () => {
    if (batchMode) {
      exitBatchMode()
      return
    }
    setBatchMode(true)
  }

  const toggleSelect = (task: TaskItem) => {
    setSelected(prev => {
      const next = new Set(prev)
      const key = task.id ?? task.title
      if (next.has(key)) {
        next.delete(key)
        return next
      }
      next.add(key)
      return next
    })
  }

  const handleBatchAction = (transition: TaskTransition) => {
    if (!selectedTasks.length) return
    const message = selectedTasks
      .map(task => `任务「${task.title}」：${transition.instruction}`)
      .join('\n')
    sendTaskMessage(message)
    setActionHint(taskPanelCopy.handedToAI())
    exitBatchMode()
  }

  const countByStatus: Record<string, number> = {}
  tasks.forEach(t => { countByStatus[t.status] = (countByStatus[t.status] ?? 0) + 1 })

  const steps: FlowStep[] = TASK_FLOW_ORDER.map(status => ({
    status,
    dot: (TASK_STATUS_STYLE[status] ?? TASK_STATUS_STYLE['处理中']).dot,
    count: countByStatus[status] ?? 0,
    disabled: !countByStatus[status],
  }))

  const filtered = filter ? tasks.filter(t => t.status === filter) : tasks
  const statusOrder: Record<string, number> = {
    '处理中': 1,
    '待验证': 2,
    '待交接': 3,
    '已完成': 4,
  }

  return (
    <div className={css['panel-container']}>
      <FlowFilterBar
        steps={steps}
        total={tasks.length}
        activeFilter={filter}
        onFilter={setFilter}
        updatedAt={null}
        batchMode={batchMode}
        batchDisabled={tasks.length < 2}
        onToggleBatchMode={toggleBatchMode}
        selectedCount={selectedTasks.length}
        batchTransitions={sharedTransitions}
        onBatchAction={handleBatchAction}
        onClearSelection={exitBatchMode}
      />
      {actionHint && (
        <TaskActionHint
          message={actionHint}
          className={css['task-action-hint']}
          onClose={() => setActionHint(null)}
        />
      )}
      {/* <AttentionHint
        steps={steps}
        onClick={() => setFilter(ATTENTION_STATUS)}
        onHoverChange={setHintHovering}
      /> */}
      <div className={css['panel-list']}>
        {filtered.length > 0
          ? filtered
              .map((task, index) => ({ task, index }))
              .sort((a, b) => {
                const aUpdatedAt = a.task.updatedAtTimestamp
                const bUpdatedAt = b.task.updatedAtTimestamp
                if (aUpdatedAt !== undefined && bUpdatedAt !== undefined && aUpdatedAt !== bUpdatedAt) {
                  return bUpdatedAt - aUpdatedAt
                }
                if (aUpdatedAt !== undefined) return -1
                if (bUpdatedAt !== undefined) return 1

                const statusDiff = (statusOrder[a.task.status] ?? 99) - (statusOrder[b.task.status] ?? 99)
                return statusDiff || a.index - b.index
              })
              .map(({ task, index }) => (
                <TaskRow
                  key={index}
                  task={task}
                  highlightProgress={hintHovering && task.status === ATTENTION_STATUS}
                  batchMode={batchMode}
                  selectable={selectedStatus === null || task.status === selectedStatus}
                  selected={selected.has(task.id ?? task.title)}
                  allowDelete={allowDelete}
                  onToggleSelect={() => toggleSelect(task)}
                />
              ))
          : <div className={css['panel-filter-empty']}>{taskPanelCopy.noResults()}</div>
        }
      </div>
    </div>
  )
}


export default TaskPanel
