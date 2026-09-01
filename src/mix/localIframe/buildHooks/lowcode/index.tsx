import React, { useState, useEffect } from 'react'
import context from '../../../context'
import lowcodeViewCss from './index.lazy.less'
import * as lowcodeViewCssNS from './index.lazy.less'

type TabKey = 'task' | 'version' | 'review'
const css = (lowcodeViewCss as any).locals || lowcodeViewCss

type TaskStatus = '待处理' | '进行中' | '待交接' | '已完成'
interface TaskItem {
  title: string
  status: TaskStatus
  handoverTo?: string
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

const TASK_STATUS_STYLE: Record<TaskStatus, { dot: string; badgeBg: string; badgeText: string }> = {
  '待处理': {
    dot: 'var(--mybricks-text-color-disabled, #ccc)',
    badgeBg: 'var(--mybricks-bg-color-active)',
    badgeText: 'var(--mybricks-text-color-disabled, #999)',
  },
  '进行中': {
    dot: '#1677ff',
    badgeBg: 'rgba(22, 119, 255, 0.1)',
    badgeText: '#1677ff',
  },
  '待交接': {
    dot: '#fa8c16',
    badgeBg: 'rgba(250, 140, 22, 0.1)',
    badgeText: '#fa8c16',
  },
  '已完成': {
    dot: '#52c41a',
    badgeBg: 'rgba(82, 196, 26, 0.1)',
    badgeText: '#52c41a',
  },
}

const REVIEW_STATUS_STYLE: Record<ReviewStatus, { dot: string; badgeBg: string; badgeText: string }> = {
  '通过': {
    dot: '#52c41a',
    badgeBg: 'rgba(82, 196, 26, 0.1)',
    badgeText: '#52c41a',
  },
  '需修复': {
    dot: '#fa8c16',
    badgeBg: 'rgba(250, 140, 22, 0.1)',
    badgeText: '#fa8c16',
  },
  '严重问题': {
    dot: '#ff4d4f',
    badgeBg: 'rgba(255, 77, 79, 0.1)',
    badgeText: '#ff4d4f',
  },
}

const TAB_LABELS: Record<TabKey, string> = {
  task: '任务',
  version: '版本',
  review: '影响',
}

const TASK_STATUS_KEYWORDS: Array<[TaskStatus, string[]]> = [
  ['已完成', ['已完成', '完成', 'done', 'completed']],
  ['进行中', ['进行中', '进行', 'in progress', 'in-progress', 'doing']],
  ['待交接', ['待交接', '交接', 'handover', 'hand over']],
  ['待处理', ['待处理', '待', 'todo', 'pending', 'backlog']],
]

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

function parseTasks(content: string): TaskItem[] {
  const tasks: TaskItem[] = []
  const sections = splitSections(content).filter(s => /^##\s/.test(s))
  for (const section of sections) {
    const title = section.split('\n')[0].replace(/^#+\s*/, '').trim()
    if (!title) continue
    tasks.push({
      title,
      status: normalizeStatus(extractMetaField(section, '状态'), TASK_STATUS_KEYWORDS, '待处理'),
      handoverTo: extractMetaField(section, '交接给'),
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
        校准文档
      </button>
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

function TaskRow({ task }: { task: TaskItem }) {
  const [expanded, setExpanded] = useState(false)
  const style = TASK_STATUS_STYLE[task.status] ?? TASK_STATUS_STYLE['待处理']
  const hasDetail = !!task.detail

  return (
    <div
      className={`${css['panel-item']} ${hasDetail ? css['panel-item-expandable'] : ''} ${expanded ? css['panel-item-expanded'] : ''}`}
      onClick={hasDetail ? () => setExpanded(v => !v) : undefined}
    >
      <span className={css['panel-item-dot']} style={{ background: style.dot }} />
      <div className={css['panel-item-body']}>
        <div className={css['panel-item-header']}>
          <span className={css['panel-item-title']}>{task.title}</span>
          <div className={css['panel-item-right']}>
            <span
              className={css['panel-item-badge']}
              style={{ background: style.badgeBg, color: style.badgeText }}
            >
              {task.status}
            </span>
            {hasDetail && <ChevronIcon expanded={expanded} />}
          </div>
        </div>
        {task.summary && (
          <div className={css['panel-item-desc']}>{task.summary}</div>
        )}
        {task.handoverTo && (
          <div className={css['panel-item-meta']}>交接给：{task.handoverTo}</div>
        )}
        {hasDetail && expanded && <DetailContent detail={task.detail!} />}
      </div>
    </div>
  )
}

function ReviewRow({ item }: { item: ReviewItem }) {
  const [expanded, setExpanded] = useState(false)
  const style = REVIEW_STATUS_STYLE[item.status] ?? REVIEW_STATUS_STYLE['需修复']
  const hasDetail = !!item.detail

  return (
    <div
      className={`${css['panel-item']} ${hasDetail ? css['panel-item-expandable'] : ''} ${expanded ? css['panel-item-expanded'] : ''}`}
      onClick={hasDetail ? () => setExpanded(v => !v) : undefined}
    >
      <span className={css['panel-item-dot']} style={{ background: style.dot }} />
      <div className={css['panel-item-body']}>
        <div className={css['panel-item-header']}>
          <span className={css['panel-item-title']}>{item.title}</span>
          <div className={css['panel-item-right']}>
            <span
              className={css['panel-item-badge']}
              style={{ background: style.badgeBg, color: style.badgeText }}
            >
              {item.status}
            </span>
            {hasDetail && <ChevronIcon expanded={expanded} />}
          </div>
        </div>
        {item.summary && (
          <div className={css['panel-item-desc']}>{item.summary}</div>
        )}
        {hasDetail && expanded && <DetailContent detail={item.detail!} />}
      </div>
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

  const chips: FilterChip[] = (Object.keys(TASK_STATUS_STYLE) as TaskStatus[])
    .filter(s => tasks.some(t => t.status === s))
    .map(s => ({
      status: s,
      dot: TASK_STATUS_STYLE[s].dot,
      count: tasks.filter(t => t.status === s).length,
    }))

  const filtered = filter ? tasks.filter(t => t.status === filter) : tasks

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
          ? filtered.map((task, i) => <TaskRow key={i} task={task} />)
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
          ? filtered.map((item, i) => <ReviewRow key={i} item={item} />)
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
        {activeTab === 'version' && (
          <div className={css['panel-empty']}>
            <span className={css['panel-empty-text']}>版本</span>
          </div>
        )}
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
    ]
  },
}
