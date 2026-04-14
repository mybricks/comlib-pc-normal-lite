import React, { memo, useState } from 'react'
import ErrorBoundary from './ErrorBoundary'
// [TODO] 循环引用
import type { FilesMap } from '../fileSystem'

interface HotComponentProps {
  entry: FilesMap[string]
}
const genHotComponent = ({ entry }: HotComponentProps) => {
  return memo((props) => {
    const [state, setState] = useState(false)
    entry.forceUpdate = () => setState(!state)

    return entry.currentImpl(props)
  }) 
}

export default genHotComponent
