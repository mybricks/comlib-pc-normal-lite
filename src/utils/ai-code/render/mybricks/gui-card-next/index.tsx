import runtime from './runtime'
import design from './design'
import createLogger from '../utils/createLogger'
import { useCardApis, useCardAction } from './hooks/card'
import type { CreateMyBricksProps } from '../type'

const createMyBricks = (props: CreateMyBricksProps) => {
  const mybricks: any = props.env.runtime ? runtime(props) : design(props)

  mybricks.logger = createLogger(props)
  mybricks.useCardApis = useCardApis
  mybricks.useCardAction = useCardAction

  console.log('[mybricks]', mybricks)

  return mybricks
}

export default createMyBricks
