import React, { memo, useReducer, useEffect } from 'react'
// [TODO] 循环引用
import type { FilesMap } from '../fileSystem'
import { PROXY_MARKER } from '../hackProxy'
import type { LoadingView } from '../../types'

interface HotComponentProps {
  entry: FilesMap[string]
  LoadingView: LoadingView
}
const genHotComponent = ({ entry, LoadingView }: HotComponentProps) => {
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
      return <LoadingView tip='依赖加载中...' withContainer={false}/>
    }

    return <Impl {...props}/>
  }) 
}

export default genHotComponent
