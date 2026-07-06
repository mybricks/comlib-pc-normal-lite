import { useContext, createContext, useEffect, useId } from 'react'

export const CardContext = createContext<{
  register: (slotKey: string, apis: any) => void,
  unregister: (slotKey: string) => void
}>({
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
