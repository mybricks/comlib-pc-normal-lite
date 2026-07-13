import React, { useEffect, useRef, useState } from 'react'
import { ClearOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { createShowCardTool, buildAvailableCardsSection } from './tools/cards-manager'
import { createCallCardApiTool } from './tools/callUiCardApi'
import type { CardGroup } from './tools/cards-manager/types'
import {
  EmptyGuide,
  renderImageLikeNode,
  type ChatHeaderConfig,
  type EmptyGuideConfig,
} from './empty-guide'
import { usePinCards } from './use-pin-cards'

import css from './index.less'

interface AIChatPanelProps {
  /** 卡片列表 */
  cards?: any[]
  /** 工具列表 */
  tools?: any[]
  /** gui_card 完整配置 */
  config?: EmptyGuideConfig
  disabled?: boolean
  history?: any
}

// ─── ChatHeader ───────────────────────────────────────────────────────────────

interface ChatHeaderProps extends ChatHeaderConfig {
  onClear: () => void
  clearDisabled?: boolean
}

function ChatHeader({ icon, title, onClear, clearDisabled }: ChatHeaderProps) {
  return (
    <div className={css.chatHeader}>
      <div className={css.chatHeaderBrand}>
        <span className={css.chatHeaderLogo}>
          {renderImageLikeNode(icon, 'logo', css.chatHeaderLogoImage)}
        </span>
        <span className={css.chatHeaderName}>{title}</span>
      </div>
      <div className={css.chatHeaderActions}>
        <Tooltip title="清空会话记录">
          <button
            type="button"
            className={css.chatHeaderAction}
            aria-label="清空会话记录"
            disabled={clearDisabled}
            onClick={onClear}
          >
            <ClearOutlined />
          </button>
        </Tooltip>
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
  disabled = false,
  history
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
  const agentRef = useRef<any>(null)
  const guiCard = config ?? {}

  useEffect(() => {
    try {
      const agent = createAgent({
        key: 'chat-panel',
        get tools() {
          const cardTools = cards.length > 0
            ? [
                createShowCardTool(cards, {
                  onPin: (name, props) => pinActionsRef.current.pin(name, props),
                  onUnPin: (pinKey) => pinActionsRef.current.unPin(pinKey),
                  isPinned: (name, props) => pinActionsRef.current.isPinned(name, props),
                  get agent() {
                    return agentRef.current
                  }
                }),
                createCallCardApiTool(),
              ]
            : []
          return [...cardTools, ...tools]
        },
        getAttachmentContextMessages: () => {
          return [buildAvailableCardsSection(cards)]
        },
        disabledModes: ["plan"],
        history
      })
      agentRef.current = agent
      setAgent(agent)
    } catch (e) {
      console.error(e)
    }
  }, [cards, createAgent, history, tools])

  const handleClearChat = async () => {
    if (!agent || disabled) return
    try {
      await agent.clearHistory?.()
      setSessionKey((key) => key + 1)
    } catch (e) {
      console.error('[AIChatPanel] clear history failed', e)
    }
  }

  const copilotConfig = {
    name: guiCard.assistantTitle,
    avatar: guiCard.icon
  }

  const themeStyle = guiCard.colorPrimary ? {
    '--mybricks-color-primary': guiCard.colorPrimary,
  } as React.CSSProperties : undefined

  const resolvedHeader = guiCard.header
  const headerConfig = resolvedHeader === false ? null : {
    ...resolvedHeader,
    icon: copilotConfig.avatar,
    title: copilotConfig.name,
  }

  if (!agent) {
    return (
      <div
        className={css.wrapper}
        data-zone-type='ai-fixed'
        style={themeStyle}
      >
        <div className={css.agentLoading}>
          <span className={css.agentLoadingSpinner} />
          <span>正在初始化会话...</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={css.wrapper}
      data-zone-type='ai-fixed'
      style={themeStyle}
    >
      {headerConfig && (
        <ChatHeader
          {...headerConfig}
          onClear={handleClearChat}
          clearDisabled={disabled}
        />
      )}
      <div className={css.chatBody} data-zone-type='ai-fixed'>
        <ChatPanel
          key={sessionKey}
          size={'large'}
          ref={chatPanelRef}
          agent={agent}
          header={false}
          disabled={disabled}
          placeholder={guiCard.placeholder}
          markdownSkin={{
            message: css.markdownSkinMessage,
            plan: css.markdownSkinMessage,
          }}
          scrollWithSender
          messagesRenderVariant="line"
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
          messagesRenderVariant="line"
        />
      </div>
    </div>
  )
}

export default AIChatPanel
