import { useContext, createContext, useEffect } from 'react'

export const CardContext = createContext<{
  register: (apis: any) => void,
  unregister: () => void
}>({
  register: () => {},
  unregister: () => {}
})

export const useCardApis = (apis) => {
  const { register, unregister } = useContext(CardContext)
  register(apis)
  useEffect(() => {
    return () => {
      unregister()
    }
  }, [])
}
