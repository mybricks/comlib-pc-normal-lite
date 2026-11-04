import mixContext from '../../../../mix/context'
import { getShadowRoot } from '../../../../helpers/designer'
import commonLang from '../../../../helpers/i18n/common'
import { parseCanvasInteractiveScripts, parseInteractiveScripts } from '../../interactiveScripts'
import { resetWindowProxy } from '../useDependencies/windowProxyStore'

let activeZoneStatusKey: string | undefined

export function notifyPageStatuses(pagePaths: string[]) {
  try {
    const shadowRoot = getShadowRoot()
    const scriptFile = mixContext.component!.params!.data.files.find(
      (file) => file.fileName === '.agent/display-mock/interactive-scripts.yaml'
    )
    const pagesScripts = scriptFile
      ? parseInteractiveScripts(decodeURIComponent(scriptFile.source))
      : []

    pagePaths.forEach((path) => {
      const page = pagesScripts.find((entry) => entry.page === path)
      if (!page) {
        const pageDom = shadowRoot.querySelector(`[data-desn-page="${path}"]`)
        mixContext.component?.actions?.notifyPageStatus(
          path,
          pageDom?.querySelector('[data-zone-status]') ? [] : null
        )
        return
      }

      mixContext.component?.actions?.notifyPageStatus(
        path,
        page.locations.map(({ title, fileName, loc, scripts }) => {
          const locationKey = [path, fileName, loc]
          const normalKey = JSON.stringify([...locationKey, 'normal'])
          return {
            title,
            items: [
              {
                title: commonLang.normal,
                activated: activeZoneStatusKey === normalKey,
                switchTo: () => {
                  activeZoneStatusKey = normalKey
                  resetWindowProxy()
                }
              },
              ...scripts.map(({ title: scriptTitle, script }, scriptIndex) => {
                const scriptKey = JSON.stringify([...locationKey, 'script', scriptTitle, scriptIndex])
                return {
                  title: scriptTitle,
                  activated: activeZoneStatusKey === scriptKey,
                  switchTo: () => {
                    activeZoneStatusKey = scriptKey
                    try {
                      // 每次执行前恢复原值，场景之间互斥。
                      resetWindowProxy()
                      eval(script)
                    } catch (e) {
                      console.error(e)
                    }
                  }
                }
              })
            ]
          }
        })
      )
    })
  } catch (e) {
    console.error(e)
  }
}

/** 按当前渲染的画布标识匹配并通知展示场景，不依赖路由列表。 */
export function notifyCanvasStatuses() {
  try {
    const shadowRoot = getShadowRoot()
    const scriptFile = mixContext.component!.params!.data.files.find(
      (file) => file.fileName === '.agent/display-mock/interactive-scripts.yaml'
    )
    const canvasScripts = scriptFile
      ? parseCanvasInteractiveScripts(decodeURIComponent(scriptFile.source))
      : []

    shadowRoot.querySelectorAll('[data-canvas-tag]').forEach((canvasDom) => {
      const canvasTag = canvasDom.getAttribute('data-canvas-tag')
      const path = canvasDom.getAttribute('data-desn-page')
      if (!path) return
      const canvas = canvasScripts.find((entry) => entry.canvas === canvasTag)
        ?? canvasScripts.find((entry) => entry.canvas === path)
      if (!canvas) {
        mixContext.component?.actions?.notifyPageStatus?.(
          path,
          canvasDom.querySelector('[data-zone-status]') ? [] : null
        )
        return
      }

      mixContext.component?.actions?.notifyPageStatus?.(
        path,
        canvas.components.map(({ title, fileName, loc, scripts }) => {
          const locationKey = [canvasTag, fileName, loc]
          const normalKey = JSON.stringify([...locationKey, 'normal'])
          return {
            title,
            items: [
              {
                title: commonLang.normal,
                activated: activeZoneStatusKey === normalKey,
                switchTo: () => {
                  activeZoneStatusKey = normalKey
                  resetWindowProxy()
                }
              },
              ...scripts.map(({ title: scriptTitle, script }, scriptIndex) => {
                const scriptKey = JSON.stringify([...locationKey, 'script', scriptTitle, scriptIndex])
                return {
                  title: scriptTitle,
                  activated: activeZoneStatusKey === scriptKey,
                  switchTo: () => {
                    activeZoneStatusKey = scriptKey
                    try {
                      // 每次执行前恢复原值，场景之间互斥。
                      resetWindowProxy()
                      eval(script)
                    } catch (e) {
                      console.error(e)
                    }
                  }
                }
              })
            ]
          }
        })
      )
    })
  } catch (e) {
    console.error(e)
  }
}
