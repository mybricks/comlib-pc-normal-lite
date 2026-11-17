import React, { forwardRef, useLayoutEffect, useRef, useState } from 'react'

interface CanvasZoneProps {
  id: string
  kind?: 'page' | 'popup'
  title?: string
  filename?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

export const CanvasZone = forwardRef<HTMLDivElement, CanvasZoneProps>(
  ({ id, kind = 'page', title, filename, style, children }, ref) => (
    <div
      ref={ref}
      data-zone-type='page'
      data-zone-kind={kind}
      data-desn-page={id}
      data-zone-title={title}
      data-zone-filename={filename}
      style={style}
    >
      {children}
    </div>
  )
)

// 等容器挂载后再渲染内容，以便组件拿到实际的 popupNode。
export const useCanvasContainer = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<HTMLDivElement>()

  useLayoutEffect(() => {
    setContainer(containerRef.current!)
  }, [])

  return { containerRef, container }
}

export const ExtensionEditor = ({ render: Render }: { render: React.ComponentType<any> }) => (
  <Render
    context={{
      prd: {
        async get() {
          return null
        }
      }
    }}
  />
)
