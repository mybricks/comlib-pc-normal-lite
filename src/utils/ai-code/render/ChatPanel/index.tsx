import React, { useEffect, useRef, useState } from 'react'
import { ChatPanel, Agent, IDBHistory, createRequestAsStream } from '../../../../../../plugin-ai/packages/plugin/src/index'
import { createShowCardTool, buildAvailableCardsSection } from './cards-manager'

import css from './index.less'

const AIChatPanel = ({ key, cardsGroups }) => {
  const chatPanelRef = useRef(null)

  const [agent, setAgent] = useState<Agent>()

  useEffect(() => {
    try {
      const agent = new Agent({
        key: key,
        tools: [
          createShowCardTool(cardsGroups),
        ],
        request: (params) => {
          return createRequestAsStream()?.(params)
        },
        history: new IDBHistory({
          dbName: "@plugin-ai/simple-chat",
        }),
        getAttachmentContextMessages: () => [buildAvailableCardsSection(cardsGroups)]
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