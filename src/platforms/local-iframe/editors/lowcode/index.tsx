import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { message } from 'antd'
import context from '../../../../mix/context'
import lowcodeViewCss from './index.lazy.less'
import * as lowcodeViewCssNS from './index.lazy.less'
import myContext, { type VersionRecord } from '../../context'
import VersionListView, { Popconfirm } from '../../../../components/version-list'
import { i18n as lowcodeI18n } from './index.i18n'
import TaskPanel, { hasTasks } from '../../../../components/task-panel'
import taskPanelCss from '../../../../components/task-panel/index.lazy.less'
import * as taskPanelCssNS from '../../../../components/task-panel/index.lazy.less'
import versionListViewCss from '../../../../components/version-list/index.lazy.less'
import * as versionListViewCssNS from '../../../../components/version-list/index.lazy.less'
import Xterm from '../../../../components/xterm'
import understandCss from '../../../../mix/understand-any/index.lazy.less'
import * as understandCssNS from '../../../../mix/understand-any/index.lazy.less'
import taskVerifyCss from '../../../../mix/tasks/verify-block/index.lazy.less'
import * as taskVerifyCssNS from '../../../../mix/tasks/verify-block/index.lazy.less';
import { getCurrentTasksPath, localFileEvents, readLocalFiles } from '../../sandbox'

type TabKey = 'task' | 'review' | 'version' | 'terminal'
const css = (lowcodeViewCss as any).locals || lowcodeViewCss

const TAB_LABELS: Record<TabKey, string> = {
  task: lowcodeI18n.taskTab(),
  version: lowcodeI18n.versionTab(),
  review: lowcodeI18n.reviewTab(),
  terminal: lowcodeI18n.processTab(),
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
      ;(messageHack || message).error(lowcodeI18n.rollbackFailed())
    }).catch(() => {
      const messageHack = (window as any)['@m-ui/react']?.message
      ;(messageHack || message).error(lowcodeI18n.rollbackFailed())
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
      <span className={css['review-meta-desc']}>{lowcodeI18n.reviewDescription()}</span>
      <div className={css['review-meta-right']}>
        {generatedAt && (
          <span className={css['review-meta-time']}>{generatedAt}</span>
        )}
        <span className={css['review-meta-reevaluate']} onClick={onReEvaluate}>{lowcodeI18n.reevaluate()}</span>
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
          <span className={css['panel-empty-text']}>{lowcodeI18n.reviewEmpty()}</span>
          <button className={css['review-btn']} onClick={handleReviewClick}>
            {lowcodeI18n.reviewAction()}
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

function RuntimePanel() {
  const [snapshot, setSnapshot] = useState(() => myContext.runtime.getSnapshot())
  const panelRef = useRef<HTMLDivElement>(null)
  const [colors, setColors] = useState({ background: '#fff', foreground: '#333' })
  const [pendingAction, setPendingAction] = useState<'start' | 'stop' | 'restart' | null>(null)
  const [confirmAction, setConfirmAction] = useState<'stop' | 'restart' | null>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const refreshColors = () => {
      const style = getComputedStyle(panel)
      const background = style.backgroundColor
      const foreground = style.color
      setColors(current => current.background === background && current.foreground === foreground
        ? current : { background, foreground })
    }
    refreshColors()
    const observer = new MutationObserver(refreshColors)
    let node: Node | null = panel
    while (node) {
      if (node instanceof Element) observer.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
      const root = node.getRootNode()
      node = node.parentNode || (root instanceof ShadowRoot ? root.host : null)
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', refreshColors)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', refreshColors)
    }
  }, [])

  const terminalOptions = useMemo(() => ({
    scrollback: 500,
    fontSize: 13,
    lineHeight: 1.5,
    theme: { background: colors.background, foreground: colors.foreground },
  }), [colors])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = myContext.runtime.events.on('runtimeUpdate', () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        setSnapshot(myContext.runtime.getSnapshot())
      }, 100)
    }, false)
    setSnapshot(myContext.runtime.getSnapshot())
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])

  const handleProcessAction = useCallback(async (action: 'start' | 'stop' | 'restart') => {
    setPendingAction(action)
    try {
      await myContext.runtime[action]()
    } catch (error) {
      const messageHack = (window as any)['@m-ui/react']?.message
      ;(messageHack || message).error(error instanceof Error ? error.message : lowcodeI18n.processActionFailed())
    } finally {
      setPendingAction(current => current === action ? null : current)
    }
  }, [])

  const stateLabels = {
    starting: lowcodeI18n.processStarting(),
    ready: lowcodeI18n.processRunning(),
    stopping: lowcodeI18n.processStopping(),
    stopped: lowcodeI18n.processStopped(),
    error: lowcodeI18n.processError(),
  }

  const state = snapshot.status?.state
  const active = state === 'starting' || state === 'ready'

  useEffect(() => {
    if (!active || pendingAction) setConfirmAction(null)
  }, [active, pendingAction])

  return (
    <div ref={panelRef} className={css['terminal-panel']} data-zone-type="ai-request">
      <div className={css['terminal-status']}>
        <div className={css['terminal-details']}>
          <span>{lowcodeI18n.status()}：{state ? stateLabels[state] : lowcodeI18n.notStarted()}</span>
          {state === 'ready' && snapshot.status?.url && <span title={snapshot.status.url}>{lowcodeI18n.address()}：{snapshot.status.url}</span>}
        </div>
        {snapshot.supportsControls && <div className={css['terminal-actions']}>
          {active ? <>
            <Popconfirm
              title={lowcodeI18n.restartConfirm()}
              visible={confirmAction === 'restart'}
              onVisible={visible => setConfirmAction(visible ? 'restart' : null)}
              onConfirm={() => void handleProcessAction('restart')}
            >
              <button type="button" disabled={Boolean(pendingAction)}>{lowcodeI18n.restart()}</button>
            </Popconfirm>
            <Popconfirm
              title={lowcodeI18n.stopConfirm()}
              visible={confirmAction === 'stop'}
              onVisible={visible => setConfirmAction(visible ? 'stop' : null)}
              onConfirm={() => void handleProcessAction('stop')}
            >
              <button type="button" disabled={pendingAction === 'stop' || pendingAction === 'restart'}>{lowcodeI18n.stop()}</button>
            </Popconfirm>
          </> : <button type="button" onClick={() => void handleProcessAction(state === 'error' ? 'restart' : 'start')} disabled={Boolean(pendingAction) || state === 'stopping'}>{lowcodeI18n.start()}</button>}
        </div>}
      </div>
      <div className={css['terminal-output']}>
        <Xterm output={snapshot.processOutput} options={terminalOptions} />
      </div>
    </div>
  )
}

function LowcodeViewShell() {
  const pluginNames: string[] = (window as any)._sandbox_?.config?.pluginNames ?? []
  const taskPanelEnabled = pluginNames.includes('task-first') || pluginNames.includes('task-overview')
  const [activeTab, setActiveTab] = useState<TabKey>('task')
  const [tasksContent, setTasksContent] = useState<string | null>(null)
  const [overviewContent, setOverviewContent] = useState<string | null>(null)
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [reviewContent, setReviewContent] = useState<string | null>(null)
  const taskRevisionRef = useRef(0)
  const hasAutoSelectedTaskRef = useRef(false)

  useEffect(() => {
    const unsubTasks = context.tasksEvents.on('change', (content) => {
      taskRevisionRef.current += 1
      setTasksContent(content)
    }, true)
    const unsubReview = context.reviewEvents.on('change', setReviewContent, true)
    return () => {
      unsubTasks()
      unsubReview()
    }
  }, [])

  useEffect(() => {
    if (!taskPanelEnabled) return
    let active = true
    let revision = 0
    const refresh = async () => {
      const current = ++revision
      const taskRevision = taskRevisionRef.current
      try {
        const taskPath = await getCurrentTasksPath()
        const overviewPath = taskPath.replace(/TASKS\.md$/, 'overview.yaml')
        const files = await readLocalFiles([taskPath, overviewPath])
        if (active && current === revision) {
          setOverviewContent(files.find(file => file.path === overviewPath)?.content ?? null)
          if (taskRevision === taskRevisionRef.current) {
            setTasksContent(files.find(file => file.path === taskPath)?.content ?? null)
          }
          setTasksLoaded(true)
        }
      } catch {
        if (active && current === revision) {
          setOverviewContent(null)
          if (taskRevision === taskRevisionRef.current) setTasksContent(null)
          setTasksLoaded(true)
        }
      }
    }
    const off = localFileEvents.on('filesChanged', refresh)
    void refresh()
    return () => { active = false; off() }
  }, [taskPanelEnabled])

  const hasTaskPanel = taskPanelEnabled && (overviewContent !== null || hasTasks(tasksContent))

  useEffect(() => {
    if (tasksLoaded && !hasTaskPanel && activeTab === 'task') setActiveTab('version')
  }, [activeTab, hasTaskPanel, tasksLoaded])

  useEffect(() => {
    if (!hasTaskPanel || hasAutoSelectedTaskRef.current) return
    hasAutoSelectedTaskRef.current = true
    if (activeTab === 'version') setActiveTab('task')
  }, [activeTab, hasTaskPanel])

  return (
    <div className={css['lowcode-view-container']}>
      <div className={css['lowcode-view-toolbar']}>
        <div className={css['lowcode-view-toolbar-tabs']}>
          <div className={css['lowcode-view-toolbar-left']}>
            {(['task', 'version', 'review', 'terminal'] as TabKey[])
              .filter(tab => tab !== 'task' || hasTaskPanel)
              .map((tab) => (
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
        {activeTab === 'task' && hasTaskPanel && <TaskPanel content={tasksContent} overviewContent={overviewContent} allowDelete />}
        {activeTab === 'version' && <VersionPanel />}
        {activeTab === 'review' && <ReviewPanel content={reviewContent} />}
        {activeTab === 'terminal' && <RuntimePanel />}
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
      },
      {
        css: transform(understandCssNS),
        use: genUse(understandCss)
      },
      {
        css: transform(taskVerifyCssNS),
        use: genUse(taskVerifyCss)
      }
    ]
  },
}
