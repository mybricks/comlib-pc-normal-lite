import React, { useEffect, useRef, useState } from 'react'
import { ChatPanel, Agent } from '/Users/lianglihao/Documents/GitHub/plugin-ai/packages/plugin/src/index'

import css from './index.less'

const AIChatPanel = ({ chat }) => {
  const chatPanelRef = useRef(null)

  const [agent, setAgent] = useState<Agent>()

  useEffect(() => {
    try {
      const agent = new Agent(chat.agent)
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
        {...chat.panel}
      />
    </div>
  )
}

export default AIChatPanel