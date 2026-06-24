import React, { useEffect, useRef, useState } from 'react'
import { ClearOutlined, ExportOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { createShowCardTool, buildAvailableCardsSection } from './tools/cards-manager'
import { createCallCardApiTool } from './tools/callUiCardApi'

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
}

function EmptyGuide({
  agent,
  icon,
  title = '开始对话',
  titleHighlight,
  subtitle = '你可以向我提问',
  groups = [],
  disabled = false,
}: EmptyGuideProps) {
  const handleCaseClick = (label: string) => {
    if (disabled) return
    agent?.requestAI?.({ message: label })
  }

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

      {/* Groups */}
      {groups.length > 0 && (
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
      )}
    </div>
  )
}

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

  useEffect(() => {
    try {
      const agent = createAgent({
        system: `你是一个可以渲染交互式 UI 卡片的 AI 助手。

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

**绝对不要**为了获取已有卡片的数据而重新渲染一张新卡片。`,
        get tools() {
          return [
            createShowCardTool(cards),
            createCallCardApiTool(),
            ...tools
          ]
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
          scrollWithSender
          renderEmpty={() => <EmptyGuide agent={agent} disabled={disabled} {...guiCard} />}
        />
      </div>
    </div>
  )
}

export default AIChatPanel
