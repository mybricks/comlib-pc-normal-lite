import { RefObject, useEffect } from 'react'
import { VIEWPORT_UNIT_VARIABLES } from '../constants'

type ElementSize = {
  width: number
  height: number
}

const useElementResizeObserver = (eleRef: RefObject<HTMLElement>) => {
  useEffect(() => {
    // 1. 获取当前要监听尺寸变化的元素，元素不存在时直接退出。
    const element = eleRef.current
    if (!element) {
      return
    }

    // 2. 记录已提交尺寸和待提交尺寸，避免同一尺寸反复触发写入。
    let frameId: number | null = null
    let lastSize: ElementSize | null = null
    let pendingSize: ElementSize | null = null

    // 3. 只初始化一次浏览器视口基准，避免未显式设置尺寸时回退到元素自身尺寸。
    const defaultSize: ElementSize = {
      width: document.body?.clientWidth || document.documentElement.clientWidth || element.clientWidth,
      height: document.body?.clientHeight || document.documentElement.clientHeight || element.clientHeight
    }

    // 4. 显式设置的 style 尺寸优先，未设置的尺寸使用初始化时的 body 尺寸。
    const getFixedSize = () => {
      const width = parseInt(element.style.width, 10)
      const height = parseInt(element.style.height, 10)

      return {
        width: Number.isNaN(width) ? defaultSize.width : width,
        height: Number.isNaN(height) ? defaultSize.height : height
      }
    }

    // 5. 比较尺寸是否一致，一致时跳过后续写入，防止重复回调造成循环。
    const isSameSize = (prev: ElementSize | null, next: ElementSize) => (
      prev?.width === next.width && prev?.height === next.height
    )

    // 6. 监听元素尺寸变化，ResizeObserver 只负责触发重新读取稳定的 style 尺寸。
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      const nextSize = getFixedSize()

      // 7. 如果尺寸已经提交过，或已经在等待下一帧提交，就不再重复调度。
      if (isSameSize(lastSize, nextSize) || isSameSize(pendingSize, nextSize)) {
        return
      }

      pendingSize = nextSize

      // 8. 同一帧内多次 resize 只保留最后一次，减少样式写入次数。
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }

      // 9. 放到下一帧写 CSS 变量，避免在 ResizeObserver 回调里同步改布局。
      frameId = requestAnimationFrame(() => {
        if (!pendingSize || isSameSize(lastSize, pendingSize)) {
          frameId = null
          return
        }

        const widthUnit = `${pendingSize.width / 100}px`
        const heightUnit = `${pendingSize.height / 100}px`

        // 10. 宽度变量有变化时才写入，避免无意义的 style mutation。
        if (element.style.getPropertyValue(VIEWPORT_UNIT_VARIABLES.width) !== widthUnit) {
          element.style.setProperty(VIEWPORT_UNIT_VARIABLES.width, widthUnit)
        }

        // 11. 高度变量有变化时才写入，进一步降低触发 resize 的概率。
        if (element.style.getPropertyValue(VIEWPORT_UNIT_VARIABLES.height) !== heightUnit) {
          element.style.setProperty(VIEWPORT_UNIT_VARIABLES.height, heightUnit)
        }

        // 12. 提交成功后更新上一次尺寸，并清空本帧任务状态。
        lastSize = pendingSize
        pendingSize = null
        frameId = null
      })
    })

    // 13. 开始监听元素尺寸。
    ro.observe(element)

    return () => {
      // 14. 组件卸载或 ref 变化时停止监听，并取消尚未执行的动画帧。
      ro.disconnect()
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [eleRef])
}

export { useElementResizeObserver }
