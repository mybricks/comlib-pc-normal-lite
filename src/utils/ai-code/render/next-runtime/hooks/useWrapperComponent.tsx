import { useMemo } from 'react'
import type { Wrapper } from '../types'

const useWrapperComponent = (wrapper: Wrapper | undefined) => {
  return useMemo(() => {
    return wrapper || (({ children }) => children)
  }, [])
}

export { useWrapperComponent }
