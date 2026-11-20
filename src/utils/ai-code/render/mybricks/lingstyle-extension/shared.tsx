import React, { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import getI18n from '../../../../../helpers/i18n'

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
      ai: {
        request(_options: { message: string }): void {}
      },
      command: {
        async run(options: {
          command: string
          timeoutMs?: number
          signal?: AbortSignal
          onOutput?: (output: { type: 'stdout' | 'stderr'; chunk: string }) => void
        }): Promise<{
          stdout: string
          stderr: string
          exitCode: number
          timedOut: boolean
          aborted: boolean
          outputTruncated: boolean
        }> {
          options.signal?.throwIfAborted()
          throw new Error(getI18n({
            zh: '预览模式下无法执行命令。',
            en: 'Command execution is unavailable in preview.'
          }))
        }
      },
      prd: {
        async get() {
          return null
        }
      }
    }}
  />
)
