import React, {
  type PropsWithChildren,
  type CSSProperties
} from 'react'

import css from './index.less'

interface Props extends PropsWithChildren {
  style: CSSProperties
}

const RuntimeContainer = (props: Props) => {
  return (
    <div id={'runtime-container'} className={css.runtimeContainer} style={props.style}>
      {props.children}
    </div>
  )
}

export default RuntimeContainer