import type { CSSProperties } from "react"
export const IS_CARD_CONFIG = Symbol('IS_CARD_CONFIG')
export const IS_TOOL = Symbol('IS_TOOL')
export const MOBILE_CARD_STYLE: CSSProperties = {
  width: 382,
  height: 'fit-content',
}
export const PC_CARD_STYLE: CSSProperties = {
  width: 968,
  height: 'fit-content',
}
export const CONTAINER_STYLE: CSSProperties = {
  width: 414,
  display: 'flex',
  flexDirection: 'column',
  transform: 'scale(1)',
  height: 896,
}
export const MOBILE_CONTAINER_STYLE: CSSProperties = {
  width: 414,
  display: 'flex',
  flexDirection: 'column',
  transform: 'scale(1)',
  height: 896,
}
export const PC_CONTAINER_STYLE: CSSProperties = {
  width: 1000,
  display: 'flex',
  flexDirection: 'column',
  transform: 'scale(1)',
  height: 896,
}
