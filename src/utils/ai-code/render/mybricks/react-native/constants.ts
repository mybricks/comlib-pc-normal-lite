import type { CSSProperties } from 'react'

export const PAGE_ENTRY_PATTERN = /^pages\/[^/]+\/index\.tsx$/

export const DEFAULT_STYLE: CSSProperties = {
  width: 414,
  display: 'flex',
  flexDirection: 'column',
  transform: 'scale(1)',
}
