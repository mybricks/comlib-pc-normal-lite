import type { CSSProperties } from "react"
export const IS_CARD_CONFIG = Symbol('IS_CARD_CONFIG')
export const IS_TOOL = Symbol('IS_TOOL')
export const CARD_STYLE: CSSProperties = {
  width: 382,
  height: 'fit-content',
}
export const CONTAINER_STYLE: CSSProperties = {
  width: 414,
  display: 'flex',
  flexDirection: 'column',
  transform: 'scale(1)',
  height: 896,
}
