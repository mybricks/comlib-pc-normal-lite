import React, { memo, useReducer, useEffect } from 'react'
// [TODO] 循环引用
import type { FilesMap } from '../fileSystem'
import { PROXY_MARKER } from '../hackProxy'

interface HotComponentProps {
  entry: FilesMap[string]
}
const genHotComponent = ({ entry }: HotComponentProps) => {
  return memo((props) => {
    const [, forceUpdate] = useReducer((n: number) => n + 1, 0)

    useEffect(() => {
      if (!entry.forceUpdateSet) entry.forceUpdateSet = new Set()
      entry.forceUpdateSet.add(forceUpdate)
      return () => {
        entry.forceUpdateSet?.delete(forceUpdate)
      }
    }, [])

    const Impl = entry.currentImpl

    if (Impl[PROXY_MARKER]) {
      return <div>加载中...</div>
    }

    return <Impl {...props}/>
  }) 
}

export default genHotComponent
