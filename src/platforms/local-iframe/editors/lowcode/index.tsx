import React, { useState, useEffect, useCallback } from 'react'
import { message } from 'antd'
import context from '../../../../mix/context'
import lowcodeViewCss from './index.lazy.less'
import * as lowcodeViewCssNS from './index.lazy.less'
import myContext, { type VersionRecord } from '../../context'
import VersionListView from '../../../../components/version-list'
import TaskPanel from '../../../../components/task-panel'
import taskPanelCss from '../../../../components/task-panel/index.lazy.less'
import * as taskPanelCssNS from '../../../../components/task-panel/index.lazy.less'
import versionListViewCss from '../../../../components/version-list/index.lazy.less'
import * as versionListViewCssNS from '../../../../components/version-list/index.lazy.less'

type TabKey = 'task' | 'review' | 'version'
const css = (lowcodeViewCss as any).locals || lowcodeViewCss

const TAB_LABELS: Record<TabKey, string> = {
  task: '任务',
  version: '版本',
  review: '影响',
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

function VersionPanel() {
  const [versions, setVersions] = useState<VersionRecord[]>([])
  const [isVibing, setIsVibing] = useState(() => myContext.vibe.isVibing)

  useEffect(() => {
    return myContext.vibe.events.on('change', setIsVibing)
  }, [])

  useEffect(() => {
    const off = myContext.version.events.on('list', (list) => {
      setVersions([...list])
    })
    return () => off()
  }, [])

  const handleRollback = useCallback((version: VersionRecord) => {
    void myContext.version.rollback(version.id).then((success) => {
      if (success) return

      const messageHack = (window as any)['@m-ui/react']?.message
      ;(messageHack || message).error('回滚失败，本地代码已发生变更')
    }).catch(() => {
      const messageHack = (window as any)['@m-ui/react']?.message
      ;(messageHack || message).error('回滚失败，本地代码已发生变更')
    })
  }, [])

  return (
    <div className={css['version-panel']}>
      <VersionListView
        versions={versions}
        onRollback={handleRollback}
        rollbackDisabled={isVibing}
        enableInfiniteScroll={false}
      />
    </div>
  )
}

function extractReviewGeneratedAt(content: string): string | undefined {
  const head = content.split(/\n##\s/)[0]
  const match = head.match(/\*{1,2}\s*(?:生成时间|更新时间|评估时间)\s*\*{0,2}\s*[：:]\s*(.+)/)
  return match?.[1]?.replace(/[*_`]/g, '').trim() || undefined
}

function ReviewMetaBar({
  generatedAt,
  onReEvaluate,
}: {
  generatedAt?: string
  onReEvaluate: () => void
}) {
  return (
    <div className={css['review-meta-bar']}>
      <span className={css['review-meta-desc']}>评估当前代码潜在的风险和影响</span>
      <div className={css['review-meta-right']}>
        {generatedAt && (
          <span className={css['review-meta-time']}>{generatedAt}</span>
        )}
        <span className={css['review-meta-reevaluate']} onClick={onReEvaluate}>重新评估</span>
      </div>
    </div>
  )
}

function ReviewPanel({ content }: { content: string | null }) {
  const handleReviewClick = () => {
    ;(window as any)._sandbox_?.helpers?.sendToAgent?.(context.comId, {
      message: '[$mbs-template:evaluate-impact]',
    })
  }

  if (!content) {
    return (
      <div className={css['panel-empty']}>
        <div className={css['panel-empty-inner']}>
          <span className={css['panel-empty-text']}>尚未评估变更影响</span>
          <button className={css['review-btn']} onClick={handleReviewClick}>
            评估变更影响
          </button>
        </div>
      </div>
    )
  }

  const generatedAt = extractReviewGeneratedAt(content)
  const renderReview = (window as any)._sandbox_?.helpers?.renders?.renderReviewView

  return (
    <div className={css['review-container']}>
      <ReviewMetaBar generatedAt={generatedAt} onReEvaluate={handleReviewClick} />
      <div className={css['review-body']}>
        {renderReview
          ? renderReview({ content })
          : <pre className={css['review-fallback']}>{content}</pre>
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
        {activeTab === 'task' && <TaskPanel content={tasksContent} allowDelete />}
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
      },
      {
        css: transform(taskPanelCssNS),
        use: genUse(taskPanelCss)
      }
    ]
  },
}
