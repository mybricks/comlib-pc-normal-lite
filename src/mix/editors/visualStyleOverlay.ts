import { getShadowRoot } from '../../helpers/designer'

const OVERLAY_ATTR = 'data-mybricks-visual-style-overlay'

export interface VisualStyleOverlay {
  id: string
  cssText: string
}

const getOverlayElement = (id: string) => {
  try {
    return getShadowRoot().querySelector(`style[${OVERLAY_ATTR}="${id}"]`) as HTMLStyleElement | null
  } catch {
    return null
  }
}

/** 覆盖层不持有 HTMLElement，主栈可在当前 shadow root 中安全重放。 */
export const applyVisualStyleOverlay = (overlay?: VisualStyleOverlay) => {
  if (!overlay?.cssText) return

  try {
    const shadowRoot = getShadowRoot()
    const style = getOverlayElement(overlay.id) ?? document.createElement('style')
    style.setAttribute(OVERLAY_ATTR, overlay.id)
    style.textContent = overlay.cssText
    if (!style.parentNode) shadowRoot.appendChild(style)
  } catch {
    // 画布尚未挂载时不缓存 DOM 引用；下次 redo 会重新挂载。
  }
}

export const removeVisualStyleOverlay = (overlay?: VisualStyleOverlay) => {
  getOverlayElement(overlay?.id ?? '')?.remove()
}
