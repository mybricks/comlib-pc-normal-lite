import React, { memo, useState } from 'react'
// [TODO] 循环引用
import type { FilesMap } from '../fileSystem'
import { PROXY_MARKER } from '../hackProxy'

interface HotComponentProps {
  entry: FilesMap[string]
}
const genHotComponent = ({ entry }: HotComponentProps) => {
  return memo((props) => {
    const [state, setState] = useState(false)
    entry.forceUpdate = () => {
      setState(!state)
    }

    const Impl = entry.currentImpl

    if (Impl[PROXY_MARKER]) {
      return <div>加载中...</div>
    }

    return <Impl {...props}/>
  }) 
}

export default genHotComponent
