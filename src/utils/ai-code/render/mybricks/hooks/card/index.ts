import { useContext, createContext, useEffect, useId } from 'react'

export const CardContext = createContext<{
  agent: any
  register: (slotKey: string, apis: any) => void,
  unregister: (slotKey: string) => void
}>({
  agent: undefined,
  register: () => {},
  unregister: () => {}
})

export const useCardApis = (apis) => {
  const { register, unregister } = useContext(CardContext)
  // 每个 useCardApis 调用有唯一的 slotKey，避免多个组件相互覆盖
  const slotKey = useId()

  register(slotKey, apis)

  useEffect(() => {
    return () => {
      unregister(slotKey)
    }
  }, [])
}

type CardAction =
  | {
      type: 'appendToAgentInput'
      /** 追加到 IDE AI 对话输入框的文本，用户确认后发送 */
      text: string
    }
  | {
      type: 'openExternal'
      /** 通过 IDE 宿主在系统浏览器中打开的绝对 URL（http:// 或 https://） */
      url: string
    }
  | {
      type: 'sendUserMessage'
      /** 直接以用户身份发送消息到 AI 对话，无需用户手动确认 */
      text: string
    }

export const useCardAction = () => {
  const { agent } = useContext(CardContext)

  const dispatch = (params: CardAction) => {
    if (!agent) {
      console.log('[useCardAction:dispatch]', 'agent is not found, please check if the component is wrapped by CardRenderer')
      return
    }

    if (params.type === 'sendUserMessage') {
      agent.requestAI?.({ message: params.text })
    } else {
      console.log('[useCardAction:dispatch]', 'not support card action type: ', params.type)
    }
  }

  return dispatch
}
