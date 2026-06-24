import React, { useEffect, useRef, useState } from 'react'
import { ClearOutlined, ExportOutlined, PushpinFilled, PushpinOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { createShowCardTool, buildAvailableCardsSection } from './tools/cards-manager'
import { CardRender } from './tools/cards-manager/card'
import { createCallCardApiTool } from './tools/callUiCardApi'
import type { CardGroup } from './tools/cards-manager/types'

import css from './index.less'

// ─── EmptyGuide Types ─────────────────────────────────────────────────────────

export interface EmptyGuideCase {
  /** 显示文本 */
  label: string
}

export interface EmptyGuideGroup {
  /** 分组标题 */
  title: string
  /** 分组描述（单行截断） */
  description?: string
  /** 快捷问题列表 */
  cases: EmptyGuideCase[]
}

export interface ChatHeaderConfig {
  /** 左侧图标，支持 URL 字符串或任意 ReactNode */
  icon?: React.ReactNode
  /** 左侧名称 */
  title?: string
}

export interface EmptyGuideConfig {
  /** 顶部图标，支持 URL 字符串或任意 ReactNode */
  icon?: React.ReactNode
  /** 主标题普通文字部分，如 "欢迎使用" */
  title?: string
  /** 主标题高亮文字部分，如 "Data Agent" */
  titleHighlight?: string
  /** 副标题 */
  subtitle?: string
  /** 快捷场景分组 */
  groups?: EmptyGuideGroup[]
  /** 主题色 */
  colorPrimary?: string
  /** 聊天面板头部配置 */
  header?: ChatHeaderConfig | false
  /** 助手标题，用于 Header 标题和 Copilot 名称 */
  assistantTitle?: string
  /** 输入框占位提示 */
  placeholder?: string
}

interface AIChatPanelProps {
  /** 卡片列表 */
  cards?: any[]
  /** 工具列表 */
  tools?: any[]
  /** gui_card 完整配置 */
  config?: EmptyGuideConfig
  disabled?: boolean
}

// ─── Pin Types ────────────────────────────────────────────────────────────────

/** 已 pin 卡片的存储快照，记录重现所需的最小信息 */
interface PinnedCard {
  /** 唯一键：由 name + JSON.stringify(props) 生成，参数一致则认为是同一张卡 */
  pinKey: string
  /** 卡片 name（对应 CardDef.name）*/
  name: string
  /** 渲染 props 快照 */
  props: Record<string, any>
  /** pin 时间戳 */
  pinnedAt: number
}

/** 生成 pin 唯一键 */
function makePinKey(name: string, props: Record<string, any>): string {
  return `${name}::${JSON.stringify(props)}`
}

// ─── usePinCards ──────────────────────────────────────────────────────────────

/**
 * Pin 功能逻辑层 Hook。
 *
 * 存储层为组件内部纯内存（useState），不依赖外部存储。
 * 提供 pin / unPin / isPinned 操作和 pinnedCards 状态。
 */
function usePinCards() {
  const [pinnedCards, setPinnedCards] = useState<PinnedCard[]>([])

  const pin = (name: string, props: Record<string, any>) => {
    const pinKey = makePinKey(name, props)
    setPinnedCards((prev) => {
      // 参数一致视为同一张卡，不重复 pin
      if (prev.some((c) => c.pinKey === pinKey)) return prev
      return [...prev, { pinKey, name, props, pinnedAt: Date.now() }]
    })
  }

  const unPin = (pinKey: string) => {
    setPinnedCards((prev) => prev.filter((c) => c.pinKey !== pinKey))
  }

  const isPinned = (name: string, props: Record<string, any>) =>
    pinnedCards.some((c) => c.pinKey === makePinKey(name, props))

  return { pinnedCards, pin, unPin, isPinned }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const renderImageLikeNode = (node: React.ReactNode, alt: string, className?: string) => {
  if (!node) return null
  if (typeof node === 'string') {
    return <img src={node} alt={alt} className={className} />
  }
  return node
}

const downloadJson = async ({ name, content }: { name: string; content: string }) => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

// ─── EmptyGuide Component ─────────────────────────────────────────────────────

interface EmptyGuideProps extends EmptyGuideConfig {
  agent: any
  /** 禁用态（非调试态时为 true），禁用后 case 点击无效 */
  disabled?: boolean
  /** 卡片分组（CardGroup[]），用于渲染已关注列表 */
  cardGroups?: CardGroup[]
  /** 已 pin 的卡片列表 */
  pinnedCards?: PinnedCard[]
  /** 取消 pin 回调 */
  onUnPin?: (pinKey: string) => void
  /** pin 回调（从已关注列表操作时不会触发，但 CardRender 内部会用到） */
  onPin?: (name: string, props: Record<string, any>) => void
}

function EmptyGuide({
  agent,
  icon,
  title = '开始对话',
  titleHighlight,
  subtitle = '你可以向我提问',
  groups = [],
  disabled = false,
  cardGroups = [],
  pinnedCards = [],
  onUnPin,
  onPin,
}: EmptyGuideProps) {
  const handleCaseClick = (label: string) => {
    if (disabled) return
    agent?.requestAI?.({ message: label })
  }

  // 全局唯一展开状态，保存展开卡片的 pinKey
  const [expandedPinKey, setExpandedPinKey] = useState<string | null>(null)

  const renderIcon = () => {
    if (!icon) return null
    return renderImageLikeNode(icon, 'icon')
  }

  return (
    <div className={css.emptyGuide}>
      {/* Icon */}
      {icon && <div className={css.emptyGuideIcon}>{renderIcon()}</div>}

      {/* Title */}
      <div className={css.emptyGuideTitle}>
        {title && <span className={css.emptyGuideTitleNormal}>{title}&nbsp;</span>}
        {titleHighlight && <span className={css.emptyGuideTitleHighlight}>{titleHighlight}</span>}
      </div>

      {/* Subtitle */}
      {subtitle && <div className={css.emptyGuideSubtitle}>{subtitle}</div>}

      {/* 有 pin 时显示已关注列表，无 pin 时显示 groups/cases */}
      {pinnedCards.length > 0 ? (
        <div className={css.pinnedSection}>
          <div className={css.pinnedSectionHeader}>
            <PushpinFilled className={css.pinnedSectionIcon} />
            <span className={css.pinnedSectionTitle}>已关注</span>
            <span className={css.pinnedSectionCount}>{pinnedCards.length}</span>
          </div>
          <div className={[css.pinnedCards, pinnedCards.length === 1 ? css.pinnedCardsSingle : ''].join(' ').trim()}>
            {pinnedCards
              // 如果有展开的卡片，只渲染该卡片；否则渲染全部卡片
              .filter(pinned => expandedPinKey === null || expandedPinKey === pinned.pinKey)
              .map((pinned) => (
                <div key={pinned.pinKey} className={expandedPinKey === pinned.pinKey ? css.pinnedCardItemExpanded : css.pinnedCardItem}>
                  <CollapsibleCard
                    expanded={expandedPinKey === pinned.pinKey}
                    onToggleExpand={(exp) => setExpandedPinKey(exp ? pinned.pinKey : null)}
                  >
                    <CardRender
                      groups={cardGroups}
                      name={pinned.name}
                      props={pinned.props}
                      loading={false}
                      cardId={pinned.pinKey}
                      isPinned={true}
                      onPin={onPin}
                      onUnPin={onUnPin}
                    />
                  </CollapsibleCard>
                </div>
              ))}
          </div>
        </div>
      ) : (
        groups.length > 0 && (
          <div className={css.emptyGuideGroups}>
            {groups.map((group, gi) => (
              <div key={gi} className={css.emptyGuideGroupCard}>
                <div className={css.emptyGuideGroupTitle}>{group.title}</div>
                {group.description && (
                  <div className={css.emptyGuideGroupDesc}>{group.description}</div>
                )}
                <ul className={css.emptyGuideGroupCases}>
                  {group.cases.map((c, ci) => (
                    <li
                      key={ci}
                      className={[css.emptyGuideGroupCaseItem, disabled ? css.emptyGuideGroupCaseItemDisabled : ''].join(' ').trim()}
                      onClick={() => handleCaseClick(c.label)}
                    >
                      {c.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

// ─── CollapsibleCard ─────────────────────────────────────────────────────────

/** 卡片内容超出此高度时显示渐变遮罩 + 展开按钮 */
const COLLAPSED_MAX_HEIGHT = 280

interface CollapsibleCardProps {
  children: React.ReactNode
  expanded: boolean
  onToggleExpand: (expanded: boolean) => void
}

/**
 * CollapsibleCard — 固定最大高度 + 渐变遮罩 + 展开/收起按钮。
 *
 * 用 ResizeObserver 检测内容真实高度，超出 COLLAPSED_MAX_HEIGHT 时
 * 裁剪并在底部显示渐变遮罩和「展开」按钮；展开后显示「收起」按钮。
 */
function CollapsibleCard({ children, expanded, onToggleExpand }: CollapsibleCardProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    const check = () => {
      setOverflow(el.scrollHeight > COLLAPSED_MAX_HEIGHT)
    }

    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className={[css.collapsibleCard, expanded ? css.collapsibleCardExpanded : ''].join(' ').trim()}>
      <div
        ref={contentRef}
        className={css.collapsibleContent}
        style={!expanded && overflow ? { maxHeight: COLLAPSED_MAX_HEIGHT } : undefined}
      >
        {children}
      </div>

      {overflow && !expanded && (
        <div className={css.collapsibleOverlay}>
          <div className={css.collapsibleFade} />
          <div className={css.collapsibleActions}>
            <button
              type="button"
              className={css.collapsibleBtn}
              onClick={() => onToggleExpand(true)}
            >
              展开查看详情
            </button>
          </div>
        </div>
      )}

      {overflow && expanded && (
        <div className={css.collapsibleCollapseRow}>
          <button
            type="button"
            className={css.collapsibleBtn}
            onClick={() => onToggleExpand(false)}
          >
            收起卡片
          </button>
        </div>
      )}
    </div>
  )
}

// ─── ChatHeader ───────────────────────────────────────────────────────────────

interface ChatHeaderProps extends ChatHeaderConfig {
  onExport: () => void
  onClear: () => void
  disabled: boolean
}

interface HeaderActionButtonProps {
  tooltip: string
  icon: React.ReactNode
  disabled: boolean
  onClick?: () => void
}

function HeaderActionButton({ tooltip, icon, disabled, onClick }: HeaderActionButtonProps) {
  return (
    <Tooltip title={tooltip}>
      <button
        type="button"
        className={css.chatHeaderAction}
        aria-label={tooltip}
        onClick={disabled ? undefined : onClick}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

function ChatHeader({ icon, title, disabled, onExport, onClear }: ChatHeaderProps) {
  return (
    <div className={css.chatHeader}>
      <div className={css.chatHeaderBrand}>
        <span className={css.chatHeaderLogo}>
          {renderImageLikeNode(icon, 'logo', css.chatHeaderLogoImage)}
        </span>
        <span className={css.chatHeaderName}>{title}</span>
      </div>
      <div className={css.chatHeaderActions}>
        <HeaderActionButton tooltip="导出会话记录" icon={<ExportOutlined />} disabled={disabled} onClick={onExport} />
        <HeaderActionButton tooltip="清空会话记录" icon={<ClearOutlined />} disabled={disabled} onClick={onClear} />
      </div>
    </div>
  )
}

// ─── AIChatPanel ──────────────────────────────────────────────────────────────

/**
 * 欢迎页默认配置，根据实际业务场景修改以下内容：
 *
 * - title / titleHighlight：主标题，titleHighlight 会显示为渐变高亮色
 * - subtitle：副标题说明文字
 * - icon：顶部图标，传入图片 URL 字符串或 ReactNode
 * - groups：快捷场景分组，每组包含 title（标题）、description（描述）、cases（快捷问题列表）
 *           点击 cases 中的条目会直接向 AI 发送对应消息
 */
const AIChatPanel = ({
  cards = [],
  tools = [],
  config,
  disabled = false
}: AIChatPanelProps) => {
  const { createAgent, ChatPanel } = window._sandbox_.config.componentRuntime.chat
  const chatPanelRef = useRef(null)

  const [agent, setAgent] = useState<any>()
  const [sessionKey, setSessionKey] = useState(0)

  // ── Pin 逻辑层 ────────────────────────────────────────────────────────────
  const pinActions = usePinCards()
  // ref 桥接：让 createShowCardTool 的 render 闭包始终拿到最新的 pin 状态
  const pinActionsRef = useRef(pinActions)
  pinActionsRef.current = pinActions

  useEffect(() => {
    try {
      const agent = createAgent({
        system: cards.length > 0
          ? `你是一个可以渲染交互式 UI 卡片的 AI 助手。

## 卡片渲染规则

### 何时调用 show_ui_card（渲染新卡片）
- 用户明确要求执行一个**新的动作**，如"再试一次"、"重新查询"等
- 用户的请求需要**生成新数据**或**触发新的交互流程**

### 何时调用 call_ui_card_api（查询已有卡片）
- 对话历史中已经渲染了卡片，用户的新请求是对**已有卡片数据的引用或计算**
- 例如：用户询问多张已渲染卡片之间的数据关系或计算——应通过 call_ui_card_api 查询已有卡片的数据，**不要重新渲染新卡片**
- 例如："刚才那张卡片显示的是什么"——查询已有卡片，不重新渲染

### 关键原则：对话历史中的卡片是持久存在的
每次 show_ui_card 渲染的卡片会保留在对话中，并拥有唯一的 cardId。
当用户的问题涉及**引用、组合或计算**已有卡片的数据时，你应该：
1. 从对话历史中找到相关卡片的 cardId（show_ui_card 返回值中包含）
2. 调用 call_ui_card_api 查询这些卡片的数据
3. 基于查询结果给出回答

**绝对不要**为了获取已有卡片的数据而重新渲染一张新卡片。`
          : `你是一个 AI 助手，能够理解并回答用户的问题。`,
        get tools() {
          const cardTools = cards.length > 0
            ? [
                createShowCardTool(cards, {
                  onPin: (name, props) => pinActionsRef.current.pin(name, props),
                  onUnPin: (pinKey) => pinActionsRef.current.unPin(pinKey),
                  isPinned: (name, props) => pinActionsRef.current.isPinned(name, props),
                }),
                createCallCardApiTool(),
              ]
            : []
          return [...cardTools, ...tools]
        },
        getAttachmentContextMessages: () => {
          const now = new Date()
          const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
          const weekDay = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
          const dateSection = `<current_date>\n当前日期：${dateStr} 星期${weekDay}\n</current_date>`
          return [dateSection, buildAvailableCardsSection(cards)]
        },
        disabledModes: ["plan"]
      })
      setAgent(agent)
    } catch (e) {
      console.error(e)
    }
  }, [])

  if (!agent) {
    return
  }

  const handleClearChat = async () => {
    if (!agent || disabled) return
    try {
      await agent.clearHistory?.()
      setSessionKey((key) => key + 1)
    } catch (e) {
      console.error('[AIChatPanel] clear history failed', e)
    }
  }

  const handleExportChat = async () => {
    if (!agent) return

    try {
      const content = {
        agentKey: agent.key,
        exportedAt: new Date().toISOString(),
        turns: agent.getTurns?.() ?? [],
        compactRecord: agent.getCompactRecord?.() ?? null,
      }
      const name = `chat-${Date.now()}.json`
      await downloadJson({ name, content: JSON.stringify(content) })
    } catch (e) {
      console.error('[AIChatPanel] export history failed', e)
    }
  }

  const guiCard = config ?? {}

  const copilotConfig = {
    name: guiCard.assistantTitle,
    avatar: guiCard.icon
  }

  const resolvedHeader = guiCard.header
  const headerConfig = resolvedHeader === false ? null : {
    ...resolvedHeader,
    icon: copilotConfig.avatar,
    title: copilotConfig.name,
  }

  return (
    <div
      className={css.wrapper}
      data-zone-type='ai-fixed'
      style={guiCard.colorPrimary ? {
        '--mybricks-color-primary': guiCard.colorPrimary,
      } as React.CSSProperties : undefined}
    >
      {headerConfig && (
        <ChatHeader
          {...headerConfig}
          disabled={disabled}
          onExport={handleExportChat}
          onClear={handleClearChat}
        />
      )}
      <div className={css.chatBody} data-zone-type='ai-fixed'>
        <ChatPanel
          key={sessionKey}
          copilot={copilotConfig}
          size={'large'}
          ref={chatPanelRef}
          agent={agent}
          header={false}
          disabled={disabled}
          placeholder={guiCard.placeholder}
          scrollWithSender
          renderEmpty={() => (
            <EmptyGuide
              agent={agent}
              disabled={disabled}
              {...guiCard}
              cardGroups={cards as CardGroup[]}
              pinnedCards={pinActions.pinnedCards}
              onPin={pinActions.pin}
              onUnPin={pinActions.unPin}
            />
          )}
        />
      </div>
    </div>
  )
}

export default AIChatPanel
