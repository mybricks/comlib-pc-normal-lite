import React, { useEffect, useRef, useState } from 'react'
import { createShowCardTool, buildAvailableCardsSection } from './tools/cards-manager'
import { createCallCardApiTool } from './tools/callUiCardApi'

import css from './index.less'

const AIChatPanel = ({ getCardsGroups }) => {
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
          return [buildAvailableCardsSection(getCardsGroups())]
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
      />
    </div>
  )
}

export default AIChatPanel