import mixContext from '../../../../mix/context'
import { getShadowRoot } from '../../../../helpers/designer'
import commonLang from '../../../../helpers/i18n/common'
import { parseInteractiveScripts } from '../../interactiveScripts'
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
