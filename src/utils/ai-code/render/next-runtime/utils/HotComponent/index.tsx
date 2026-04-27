import React, { memo, useReducer, useLayoutEffect } from 'react'
// [TODO] 循环引用
import type { FilesMap } from '../fileSystem'
import { PROXY_MARKER } from '../hackProxy'
import type { LoadingView, ErrorView, OnRuntimeError } from '../../types'
import ErrorBoundary from './ErrorBoundary'

interface HotComponentProps {
  entry: FilesMap[string]
  LoadingView: LoadingView
  ErrorView: ErrorView
  getVibing: () => boolean
  onRuntimeError: (error: Error) => void
}
const genHotComponent = ({
  entry,
  LoadingView,
  ErrorView,
  getVibing,
  onRuntimeError
}: HotComponentProps) => {
  return memo((props) => {
    const [resetKey, forceUpdate] = useReducer((n: number) => n + 1, 0)

    useLayoutEffect(() => {
      if (!entry.forceUpdateSet) entry.forceUpdateSet = new Set()
      entry.forceUpdateSet.add(forceUpdate)
      return () => {
        entry.forceUpdateSet?.delete(forceUpdate)
      }
    }, [])

    const Impl = entry.currentImpl

    if (Impl[PROXY_MARKER]) {
      return <LoadingView tip='加载中...' withContainer={false}/>
    }

    return (
      <ErrorBoundary
        onError={onRuntimeError}
        resetKey={resetKey}
        ErrorView={({ error }) => {
          if (getVibing()) {
            return <LoadingView tip='检测到运行错误，正在修复...' withContainer={false}/>
          }
          return <ErrorView error={error}/>
        }}
        // @ts-ignore 引擎特殊处理逻辑
        _onError_={() => {}}
      >
        <Impl {...props}/>
      </ErrorBoundary>
    )
  }) 
}

export default genHotComponent
