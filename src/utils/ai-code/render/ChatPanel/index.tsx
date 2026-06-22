import React, { useEffect, useRef, useState } from 'react'
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
}

// ─── EmptyGuide Component ─────────────────────────────────────────────────────

interface EmptyGuideProps extends EmptyGuideConfig {
  agent: any
}

function EmptyGuide({
  agent,
  icon,
  title = '欢迎使用',
  titleHighlight,
  subtitle,
  groups = [],
}: EmptyGuideProps) {
  const handleCaseClick = (label: string) => {
    agent?.requestAI?.({ message: label })
  }

  const renderIcon = () => {
    if (!icon) return null
    if (typeof icon === 'string') {
      return (
        <img
          src={icon}
          alt="icon"
          style={{ width: 80, height: 80, objectFit: 'contain' }}
        />
      )
    }
    return <>{icon}</>
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
                    className={css.emptyGuideGroupCaseItem}
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
const DEFAULT_EMPTY_GUIDE: EmptyGuideConfig = {
  title: '欢迎使用',
  titleHighlight: 'AI 助手',
  subtitle: '你可以向我提问，或从下方场景快速开始',
  groups: [
    {
      title: '场景一',
      description: '场景一的简短描述...',
      cases: [
        { label: '示例问题 1' },
        { label: '示例问题 2' },
        { label: '示例问题 3' },
      ],
    },
    {
      title: '场景二',
      description: '场景二的简短描述...',
      cases: [
        { label: '示例问题 1' },
        { label: '示例问题 2' },
        { label: '示例问题 3' },
      ],
    },
    {
      title: '场景三',
      description: '场景三的简短描述...',
      cases: [
        { label: '示例问题 1' },
        { label: '示例问题 2' },
        { label: '示例问题 3' },
      ],
    },
  ],
}

const AIChatPanel = ({ getCardsGroups, emptyGuide = DEFAULT_EMPTY_GUIDE }: { getCardsGroups: () => any; emptyGuide?: EmptyGuideConfig }) => {
  const { createAgent, ChatPanel } = window._sandbox_.config.componentRuntime.chat
  const chatPanelRef = useRef(null)

  const [agent, setAgent] = useState()

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
            createShowCardTool(getCardsGroups()),
            createCallCardApiTool()
          ]
        },
        getAttachmentContextMessages: () => {
          const now = new Date()
          const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
          const weekDay = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
          const dateSection = `<current_date>\n当前日期：${dateStr} 星期${weekDay}\n</current_date>`
          return [dateSection, buildAvailableCardsSection(getCardsGroups())]
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

  return (
    <div className={css.chatPanel} data-zone-type='ai-fixed'>
      <ChatPanel
        ref={chatPanelRef}
        agent={agent}
        header={false}
        renderEmpty={() => <EmptyGuide agent={agent} {...emptyGuide} />}
      />
    </div>
  )
}

export default AIChatPanel