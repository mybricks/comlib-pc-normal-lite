import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CardRender } from './tools/cards-manager/card'
import type { CardGroup } from './tools/cards-manager/types'
import css from './index.less'
import type { PinnedCard } from './pin-card-utils'

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
  /** 智能体名称，透传给 createAgent */
  name?: string
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
  /** 人格提示词，透传给 createAgent */
  soulMd?: string
  /** 智能体操作手册提示词，透传给 createAgent */
  agentsMd?: string
  /** 系统提示词 */
  agentMd?: string
}

export const renderImageLikeNode = (
  node: React.ReactNode,
  alt: string,
  className?: string,
) => {
  if (!node) return null
  if (typeof node === 'string') {
    return <img src={node} alt={alt} className={className} />
  }
  return node
}

/** 卡片内容超出此高度时显示渐变遮罩 + 展开按钮 */
const COLLAPSED_MAX_HEIGHT = 280

interface CollapsibleCardProps {
  children: React.ReactNode
  expanded: boolean
  onToggleExpand: (expanded: boolean) => void
}

function CollapsibleCard({
  children,
  expanded,
  onToggleExpand,
}: CollapsibleCardProps) {
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
    <div
      className={[
        css.collapsibleCard,
        expanded ? css.collapsibleCardExpanded : '',
      ]
        .join(' ')
        .trim()}
    >
      <div
        ref={contentRef}
        className={css.collapsibleContent}
        style={
          !expanded && overflow
            ? { maxHeight: COLLAPSED_MAX_HEIGHT }
            : undefined
        }
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

      {expanded && (
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

export function EmptyGuide({
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

  const [expandedPinKey, setExpandedPinKey] = useState<string | null>(null)
  const availableCardNames = useMemo(
    () => new Set(cardGroups.flatMap((group) => group.cards.map((card) => card.name))),
    [cardGroups],
  )
  const visiblePinnedCards = useMemo(
    () => pinnedCards.filter((pinned) => availableCardNames.has(pinned.name)),
    [availableCardNames, pinnedCards],
  )

  useEffect(() => {
    if (
      expandedPinKey &&
      !visiblePinnedCards.some((pinned) => pinned.pinKey === expandedPinKey)
    ) {
      setExpandedPinKey(null)
    }
  }, [expandedPinKey, visiblePinnedCards])

  const renderIcon = () => {
    if (!icon) return null
    return renderImageLikeNode(icon, 'icon')
  }

  const questions = groups.reduce<string[]>((pre, item) => {
    if (typeof item === 'string') {
      pre.push(item)
    } else if (Array.isArray(item.cases)) {
      item.cases.forEach(({ label }) => {
        pre.push(label)
      })
    }
    return pre
  }, [])

  const showPinnedOnly = visiblePinnedCards.length > 0

  return (
    <div
      className={[css.emptyGuide, showPinnedOnly ? css.emptyGuidePinned : '']
        .join(' ')
        .trim()}
    >
      {!showPinnedOnly && icon && (
        <div className={css.emptyGuideIcon}>{renderIcon()}</div>
      )}

      {!showPinnedOnly && (
        <div className={css.emptyGuideTitle}>
          {title && <span className={css.emptyGuideTitleNormal}>{title}&nbsp;</span>}
          {titleHighlight && (
            <span className={css.emptyGuideTitleHighlight}>
              {titleHighlight}
            </span>
          )}
        </div>
      )}

      {!showPinnedOnly && subtitle && (
        <div className={css.emptyGuideSubtitle}>{subtitle}</div>
      )}

      {showPinnedOnly ? (
        <div className={css.pinnedSection}>
          <div
            className={[
              css.pinnedCards,
              visiblePinnedCards.length === 1 ? css.pinnedCardsSingle : '',
            ]
              .join(' ')
              .trim()}
          >
            {visiblePinnedCards
              .filter(
                (pinned) =>
                  expandedPinKey === null || expandedPinKey === pinned.pinKey,
              )
              .map((pinned) => (
                <div
                  key={pinned.pinKey}
                  className={
                    expandedPinKey === pinned.pinKey
                      ? css.pinnedCardItemExpanded
                      : css.pinnedCardItem
                  }
                >
                  <CollapsibleCard
                    expanded={expandedPinKey === pinned.pinKey}
                    onToggleExpand={(exp) =>
                      setExpandedPinKey(exp ? pinned.pinKey : null)
                    }
                  >
                    <CardRender
                      groups={cardGroups}
                      name={pinned.name}
                      props={pinned.props}
                      loading={false}
                      cardId={pinned.pinKey}
                      pinKey={pinned.pinKey}
                      isPinned={true}
                      onPin={onPin}
                      onUnPin={onUnPin}
                      showPinOnHover={true}
                    />
                  </CollapsibleCard>
                </div>
              ))}
          </div>
        </div>
      ) : (
        questions.length > 0 && (
          <div className={css['questions-wrap']}>
            {questions.map((question, index) => {
              return (
                <li
                  key={index}
                  className={css['question-item']}
                  onClick={() => handleCaseClick(question)}
                >
                  <span className={css['question-text']}>{question}</span>
                </li>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
