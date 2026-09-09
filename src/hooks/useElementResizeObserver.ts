import { RefObject, useEffect } from 'react'
import { VIEWPORT_UNIT_VARIABLES } from '../constants'

const useElementResizeObserver = (eleRef: RefObject<HTMLElement>) => {
  useEffect(() => {
    const element = eleRef.current
    if (!element) {
      return
    }

    let frameId: number | null = null

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      const { width, height } = entry.contentRect

      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }

      frameId = requestAnimationFrame(() => {
        element.style.setProperty(VIEWPORT_UNIT_VARIABLES.width, `${width / 100}px`)
        element.style.setProperty(VIEWPORT_UNIT_VARIABLES.height, `${height / 100}px`)
        frameId = null
      })
    })

    ro.observe(element)

    return () => {
      ro.disconnect()
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [eleRef])
}

export { useElementResizeObserver }
