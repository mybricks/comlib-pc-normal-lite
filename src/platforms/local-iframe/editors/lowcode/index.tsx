import React, { useState, useEffect, useCallback } from 'react'
import context from '../../../../mix/context'
import lowcodeViewCss from './index.lazy.less'
import * as lowcodeViewCssNS from './index.lazy.less'
import myContext, { type VersionRecord } from '../../context'
import VersionListView from '../../../../components/version-list'
import versionListViewCss from '../../../../components/version-list/index.lazy.less'
import * as versionListViewCssNS from '../../../../components/version-list/index.lazy.less'

type TabKey = 'task' | 'review' | 'version'
const css = (lowcodeViewCss as any).locals || lowcodeViewCss

type TaskStatus = '处理中' | '待验证' | '待交接' | '已完成'
interface TaskMetadata {
  label: string
  value: string
}
interface TaskItem {
  title: string
  status: TaskStatus
  handoverTo?: string
  handoverReason?: string
  metadata: TaskMetadata[]
  summary?: string
  detail?: string
}

type ReviewStatus = '通过' | '需修复' | '严重问题'
interface ReviewItem {
  title: string
  status: ReviewStatus
  summary?: string
  detail?: string
}
interface ReviewData {
  updateTime?: string
  items: ReviewItem[]
}

interface FilterChip {
  status: string
  dot: string
  count: number
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

const REVIEW_STATUS_STYLE: Record<ReviewStatus, { dot: string; badgeBg: string; badgeText: string }> = {
  '通过': {
    dot: '#52c41a',
    badgeBg: '#52c41a',
    badgeText: '#fff',
  },
  '需修复': {
    dot: '#fa8c16',
    badgeBg: '#fa8c16',
    badgeText: '#fff',
  },
  '严重问题': {
    dot: '#ff4d4f',
    badgeBg: '#ff4d4f',
    badgeText: '#fff',
  },
}

const TAB_LABELS: Record<TabKey, string> = {
  task: '任务',
  version: '版本',
  review: '影响',
}

const REVIEW_STATUS_KEYWORDS: Array<[ReviewStatus, string[]]> = [
  ['严重问题', ['严重问题', '严重', 'critical', 'blocker']],
  ['需修复', ['需修复', '修复', '需要修复', 'fix', 'warning']],
  ['通过', ['通过', '允许上线', 'pass', 'ok', '✓', '✅']],
]

function normalizeStatus<T extends string>(
  raw: string | undefined,
  keywords: Array<[T, string[]]>,
  fallback: T,
): T {
  if (!raw) return fallback
  const lower = raw.toLowerCase().trim()
  for (const [status, keys] of keywords) {
    if (keys.some(k => lower.includes(k.toLowerCase()))) return status
  }
  return fallback
}

function extractMetaField(section: string, fieldName: string): string | undefined {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = section.match(
    new RegExp(`\\*{1,2}\\s*${escaped}\\s*\\*{0,2}\\s*[：:：]\\s*(.+)`, 'i')
  )
  return match?.[1]?.replace(/[*_`]/g, '').trim() || undefined
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

function extractDetail(section: string): string | undefined {
  const lines = section.split('\n')
  let passedTitle = false
  const detailLines: string[] = []

  for (const line of lines) {
    if (!passedTitle) {
      if (/^#+\s/.test(line)) passedTitle = true
      continue
    }
    if (/^\s*-\s*\*{1,2}[^*\n]+\*{0,2}\s*[：:]\s*.+/.test(line)) continue
    if (/^>\s*/.test(line)) continue
    detailLines.push(line)
  }

  const detail = detailLines.join('\n').trim()
  return detail || undefined
}

function splitSections(content: string): string[] {
  return content.split(/(?=^#{1,3}\s)/m).filter(s => /^#{1,3}\s/.test(s))
}

function extractMetadata(section: string): TaskMetadata[] {
  const metadata: TaskMetadata[] = []
  const regex = /^\s*-\s*\*{1,2}\s*([^*\n]+?)\s*\*{0,2}\s*[：:]\s*(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(section))) {
    const label = match[1].trim()
    const value = match[2].replace(/[*_`]/g, '').trim()
    if (label && label !== '状态' && value) metadata.push({ label, value })
  }
  return metadata
}

function normalizeTaskStatus(raw: string | undefined): TaskStatus {
  const status = raw?.replace(/[*_`]/g, '').trim() || '处理中'
  if (status === '待处理') return '处理中'
  if (status === '待验收') return '待验证'
  return ['处理中', '待验证', '待交接', '已完成'].includes(status)
    ? status as TaskStatus
    : '处理中'
}

function parseTasks(content: string): TaskItem[] {
  const tasks: TaskItem[] = []
  const sections = splitSections(content).filter(s => /^##\s/.test(s))
  for (const section of sections) {
    const title = section.split('\n')[0].replace(/^#+\s*/, '').trim()
    if (!title) continue
    const metadata = extractMetadata(section)
    const handoverTo = metadata.find(item => item.label === '交接给')?.value
    const handoverReason = metadata.find(item => item.label === '交接原因')?.value
    tasks.push({
      title,
      status: normalizeTaskStatus(extractMetaField(section, '状态')),
      handoverTo,
      handoverReason,
      metadata: metadata.filter(item => item.label !== '交接给' && item.label !== '交接原因'),
      summary: extractSummary(section),
      detail: extractDetail(section),
    })
  }
  return tasks
}

function parseReview(content: string): ReviewData {
  const updateTimeMatch = content.match(/^updateTime\s*[：:]\s*(.+)/m)
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*[\r\n]+/, '')
  const items: ReviewItem[] = []
  const sections = splitSections(withoutFrontmatter).filter(s => /^##\s/.test(s))
  for (const section of sections) {
    const title = section.split('\n')[0].replace(/^#+\s*/, '').trim()
    if (!title) continue
    items.push({
      title,
      status: normalizeStatus(extractMetaField(section, '状态'), REVIEW_STATUS_KEYWORDS, '需修复'),
      summary: extractSummary(section),
      detail: extractDetail(section),
    })
  }
  return {
    updateTime: updateTimeMatch?.[1]?.trim(),
    items,
  }
}

function SyncIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M13.5 4.5A6 6 0 0 0 2.5 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2.5 11.5A6 6 0 0 0 13.5 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10.5 1.5L13.5 4.5L10.5 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 8.5L2.5 11.5L5.5 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VersionListIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M3 4.5H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 11.5H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function SummaryBar({
  chips,
  total,
  activeFilter,
  onFilter,
  updatedAt,
  onCalibrate,
}: {
  chips: FilterChip[]
  total: number
  activeFilter: string | null
  onFilter: (s: string | null) => void
  updatedAt: string | null
  onCalibrate: () => void
}) {
  return (
    <div className={css['summary-bar']}>
      <div className={css['summary-chips']}>
        <div
          className={`${css['summary-chip']} ${!activeFilter ? css['summary-chip-active'] : ''}`}
          onClick={() => onFilter(null)}
        >
          <span className={css['summary-chip-label']}>全部</span>
          <span className={css['summary-chip-count']}>{total}</span>
        </div>
        {chips.map(chip => (
          <div
            key={chip.status}
            className={`${css['summary-chip']} ${activeFilter === chip.status ? css['summary-chip-active'] : ''}`}
            onClick={() => onFilter(activeFilter === chip.status ? null : chip.status)}
          >
            <span className={css['summary-chip-dot']} style={{ background: chip.dot }} />
            <span className={css['summary-chip-label']}>{chip.status}</span>
            <span className={css['summary-chip-count']}>{chip.count}</span>
          </div>
        ))}
      </div>
      {updatedAt && (
        <span className={css['summary-updated-at']}>{updatedAt}</span>
      )}
      <button className={css['calibrate-btn']} onClick={onCalibrate} title="校准文档">
        <SyncIcon />
        文档不准？校准一下
      </button>
    </div>
  )
}

function VersionPanel() {
  const [versions, setVersions] = useState<VersionRecord[]>([])

  useEffect(() => {
    const off = myContext.version.events.on('list', (list) => {
      setVersions([...list])
    })
    return () => off()
  }, [])

  const handleRollback = useCallback((version: VersionRecord) => {
    myContext.version.rollback(version.id)
  }, [])

  return (
    <div className={css['version-panel']}>
      <VersionListView
        versions={versions}
        onRollback={handleRollback}
        enableInfiniteScroll={false}
      />
    </div>
  )
}

function DetailContent({ detail }: { detail: string }) {
  return (
    <div className={css['detail-content']}>
      {detail.split('\n').map((line, i) => {
        const headingMatch = line.match(/^#{2,4}\s+(.+)/)
        if (headingMatch) {
          return <div key={i} className={css['detail-heading']}>{headingMatch[1]}</div>
        }
        const bulletMatch = line.match(/^\s*[-*]\s+(.+)/)
        if (bulletMatch) {
          return (
            <div key={i} className={css['detail-bullet']}>
              <span className={css['detail-bullet-dot']} />
              {bulletMatch[1]}
            </div>
          )
        }
        if (!line.trim()) {
          return <div key={i} className={css['detail-gap']} />
        }
        return <div key={i} className={css['detail-text']}>{line}</div>
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

interface TaskTransition {
  target: TaskStatus
  label: string
  instruction: string
  requiresReason?: boolean
}

function getTaskTransitions(task: TaskItem): TaskTransition[] {
  const transitions: Record<TaskStatus, TaskTransition[]> = {
    '处理中': [{
      target: '待验证',
      label: '代码已完成，等待我验证',
      instruction: '代码已完成，等待我验证',
      requiresReason: true,
    }],
    '待验证': [
      {
        target: '已完成',
        label: '已验证完成',
        instruction: '已验证完成',
      },
      {
        target: '处理中',
        label: '任务有问题，请重新修改',
        instruction: '任务有问题，请重新修改',
        requiresReason: true,
      },
    ],
    '待交接': [
      {
        target: '处理中',
        label: '任务有问题，请重新修改',
        instruction: '任务有问题，请重新修改',
        requiresReason: true,
      },
    ],
    '已完成': [
      {
        target: '处理中',
        label: '任务有问题，请重新修改',
        instruction: '任务有问题，请重新修改',
        requiresReason: true,
      },
    ],
  }

  if (task.status === '待验证' && task.handoverTo) {
    return [
      {
        target: '待交接',
        label: '已验证完成',
        instruction: '已验证完成',
      },
      ...transitions['待验证'].filter(item => item.target !== '已完成'),
    ]
  }
  return transitions[task.status]
}

function TaskRow({ task }: { task: TaskItem }) {
  const [expanded, setExpanded] = useState(false)
  const style = TASK_STATUS_STYLE[task.status] ?? TASK_STATUS_STYLE['处理中']
  const hasDetail = !!task.detail
  const transitions = getTaskTransitions(task)

  const handleTransition = (transition: TaskTransition) => {
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
        return
      }

      const reason = window.prompt('请填写原因')?.trim()
      if (!reason) return
      ;(window as any)._sandbox_?.helpers?.sendToAgent?.(context.comId, {
        message: `${message}\n\n原因：${reason}`,
      })
      return
    }

    ;(window as any)._sandbox_?.helpers?.sendToAgent?.(context.comId, {
      message,
    })
  }

  return (
    <div className={css['task-card']}>
      <div className={css['task-card-header']}>
        <div className={css['task-card-header-main']}>
          <span
            className={css['task-status-badge']}
            style={{ background: style.badgeBg, color: style.badgeText }}
          >
            {task.status}
          </span>
          <span className={css['task-title']} title={task.title}>{task.title}</span>
          {task.handoverTo && (
            <span className={css['task-handover-inline']}>
              <span className={css['task-handover-label']}>交接给</span>
              <UserIcon />
              <span className={css['task-handover-name']}>{task.handoverTo}</span>
              {task.handoverReason && (
                <span className={css['task-handover-tooltip']}>{task.handoverReason}</span>
              )}
            </span>
          )}
        </div>
        {transitions.length > 0 && (
          <div className={css['task-status-selector']}>
            <span className={css['task-status-selector-text']}>调整状态至</span>
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
              <option value="" disabled>调整状态至</option>
              {transitions.map(transition => (
                <option key={transition.target} value={transition.target}>{transition.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {task.summary && (
        <div className={css['task-summary']}>{task.summary}</div>
      )}

      {task.metadata.length > 0 && (
        <div className={css['task-meta-list']}>
          {task.metadata.map((item) => (
            <div key={item.label} className={css['task-meta-item']}>
              <span className={css['task-meta-label']}>{item.label}</span>
              <span className={css['task-meta-value']}>{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {hasDetail && (
        <div className={css['task-detail-toggle']} onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}>
          <ChevronIcon expanded={expanded} />
          <span>{expanded ? '收起详情' : '展开详情'}</span>
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

function ReviewRow({ item }: { item: ReviewItem }) {
  const [expanded, setExpanded] = useState(false)
  const style = REVIEW_STATUS_STYLE[item.status] ?? REVIEW_STATUS_STYLE['需修复']
  const hasDetail = !!item.detail

  return (
    <div className={css['task-card']}>
      <div className={css['task-card-header']}>
        <span
          className={css['task-status-badge']}
          style={{ background: style.badgeBg, color: style.badgeText }}
        >
          {item.status}
        </span>
        <span className={css['task-title']}>{item.title}</span>
      </div>
      {item.summary && (
        <div className={css['task-summary']}>{item.summary}</div>
      )}

      {hasDetail && (
        <div className={css['task-detail-toggle']} onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}>
          <ChevronIcon expanded={expanded} />
          <span>{expanded ? '收起详情' : '展开详情'}</span>
        </div>
      )}

      {hasDetail && expanded && (
        <div className={css['task-detail-wrapper']}>
          <DetailContent detail={item.detail!} />
        </div>
      )}
    </div>
  )
}

function TaskPanel({ content }: { content: string | null }) {
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => { setFilter(null) }, [content])

  if (!content) {
    return (
      <div className={css['panel-empty']}>
        <span className={css['panel-empty-text']}>暂无任务</span>
      </div>
    )
  }

  const tasks = parseTasks(content)
  if (!tasks.length) {
    return (
      <div className={css['panel-empty']}>
        <span className={css['panel-empty-text']}>暂无任务</span>
      </div>
    )
  }

  const chips: FilterChip[] = Array.from(new Set(tasks.map(t => t.status)))
    .map(status => ({
      status,
      dot: (TASK_STATUS_STYLE[status] ?? TASK_STATUS_STYLE['处理中']).dot,
      count: tasks.filter(t => t.status === status).length,
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
      <SummaryBar
        chips={chips}
        total={tasks.length}
        activeFilter={filter}
        onFilter={setFilter}
        updatedAt={null}
        onCalibrate={() => (window as any)._sandbox_?.helpers?.sendToAgent?.(context.comId, {
          message: '校准下当前的任务文档',
        })}
      />
      <div className={css['panel-list']}>
        {filtered.length > 0
          ? filtered
              .slice()
              .sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99))
              .map((task, i) => <TaskRow key={i} task={task} />)
          : <div className={css['panel-filter-empty']}>无匹配结果</div>
        }
      </div>
    </div>
  )
}

function ReviewPanel({ content }: { content: string | null }) {
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => { setFilter(null) }, [content])

  const handleReviewClick = () => {
    ;(window as any)._sandbox_?.helpers?.sendToAgent?.(context.comId, {
      message: '校准下当前的变更影响文档',
    })
  }

  if (!content) {
    return (
      <div className={css['panel-empty']}>
        <div className={css['panel-empty-inner']}>
          <span className={css['panel-empty-text']}>暂无影响评估</span>
          <button className={css['review-btn']} onClick={handleReviewClick}>
            生成影响评估
          </button>
        </div>
      </div>
    )
  }

  const { updateTime, items } = parseReview(content)

  if (!items.length) {
    return (
      <div className={css['panel-empty']}>
        <div className={css['panel-empty-inner']}>
          <span className={css['panel-empty-text']}>暂无影响评估</span>
          <button className={css['review-btn']} onClick={handleReviewClick}>
            生成影响评估
          </button>
        </div>
      </div>
    )
  }

  const chips: FilterChip[] = (Object.keys(REVIEW_STATUS_STYLE) as ReviewStatus[])
    .filter(s => items.some(item => item.status === s))
    .map(s => ({
      status: s,
      dot: REVIEW_STATUS_STYLE[s].dot,
      count: items.filter(item => item.status === s).length,
    }))

  const filtered = filter ? items.filter(item => item.status === filter) : items

  return (
    <div className={css['panel-container']}>
      <SummaryBar
        chips={chips}
        total={items.length}
        activeFilter={filter}
        onFilter={setFilter}
        updatedAt={updateTime ?? null}
        onCalibrate={handleReviewClick}
      />
      <div className={css['panel-list']}>
        {filtered.length > 0
          ? filtered
              .sort((a, b) => {
                const order: Record<ReviewStatus, number> = { '严重问题': 1, '需修复': 2, '通过': 3 }
                return order[a.status] - order[b.status]
              })
              .map((item, i) => <ReviewRow key={i} item={item} />)
          : <div className={css['panel-filter-empty']}>无匹配结果</div>
        }
      </div>
    </div>
  )
}

function LowcodeViewShell() {
  const [activeTab, setActiveTab] = useState<TabKey>('task')
  const [tasksContent, setTasksContent] = useState<string | null>(null)
  const [reviewContent, setReviewContent] = useState<string | null>(null)

  useEffect(() => {
    const unsubTasks = context.tasksEvents.on('change', setTasksContent, true)
    const unsubReview = context.reviewEvents.on('change', setReviewContent, true)
    return () => {
      unsubTasks()
      unsubReview()
    }
  }, [])

  return (
    <div className={css['lowcode-view-container']}>
      <div className={css['lowcode-view-toolbar']}>
        <div className={css['lowcode-view-toolbar-tabs']}>
          <div className={css['lowcode-view-toolbar-left']}>
            {(['task', 'version', 'review'] as TabKey[]).map((tab) => (
              <div
                key={tab}
                className={`${css['lowcode-view-toolbar-tab']} ${activeTab === tab ? css['lowcode-view-toolbar-tab-active'] : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={css['lowcode-view']}>
        {activeTab === 'task' && <TaskPanel content={tasksContent} />}
        {activeTab === 'version' && <VersionPanel />}
        {activeTab === 'review' && <ReviewPanel content={reviewContent} />}
      </div>
    </div>
  )
}

export default {
  render(params: any, plugins: any) {
    context.plugins = plugins;
    context.comId = params.id;
    const showAIDialog = plugins.showAIDialog;
    (window as any)._showAIDialog_ = showAIDialog;
    return <LowcodeViewShell />;
  },
  useCSS() {
    function transform(ns) {
      if (ns.default?.locals) {
        return ns.default.locals
      } else {
        return ns
      }
    }

    const genUse = (css) => {
      return css
    }

    return [
      {
        css: transform(lowcodeViewCssNS),
        use: genUse(lowcodeViewCss)
      },
      {
        css: transform(versionListViewCssNS),
        use: genUse(versionListViewCss)
      }
    ]
  },
}
