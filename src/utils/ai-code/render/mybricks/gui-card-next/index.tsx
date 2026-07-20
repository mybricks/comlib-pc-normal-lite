import runtime from './runtime'
import design from './design'
import createLogger from '../utils/createLogger'
import { useCardApis, useCardAction } from './hooks/card'
import { useExposeApi, useCanvasAction  } from './ChatPanel/tools/render-canvas/CanvasRender'
import type { CreateMyBricksProps } from '../type'

const createMyBricks = (props: CreateMyBricksProps) => {
  const mybricks: any = props.env.runtime ? runtime(props) : design(props)

  mybricks.logger = createLogger(props)
  mybricks.useCardApis = useExposeApi
  mybricks.useCardAction = useCanvasAction
  mybricks.useExposeApi = useExposeApi
  mybricks.useCanvasAction = useCanvasAction

  console.log('[mybricks]', mybricks)

  return mybricks
}

export default createMyBricks
