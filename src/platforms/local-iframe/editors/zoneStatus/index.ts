import myContext from '../../context'
import { agentTurnLifecycle } from '../../../../mix/sandbox/agent-turn-lifecycle'
import { notifyLocalPageStatuses } from '../../runtime/page-status'
import { getPagePathWithBase } from '../../runtime/page-path'

export default function(props) {
  return {
    '@getZoneStatus'(ele) {
      console.log("@getZoneStatus", ele)
      const iframeSrc = ele.dataset.iframeSrc
      const iframePath = ele.dataset.iframePath
      // data-iframe-path={item.path}
			// 			data-iframe-src={item.src}
      const iframeInfo = myContext.iframes.get(iframePath)?.get(iframeSrc)

      console.log(111, iframeInfo)

      if (!iframeInfo?.doc) {
        return null
      }

      console.log('iframeInfo', iframeInfo)

      const { doc } = iframeInfo

      return doc.querySelector('[data-zone-status]') ? [] : null

      // try {
      //   const pagePath = ele.getAttribute('data-desn-page') ?? ele.closest('[data-desn-page]')?.getAttribute('data-desn-page')
      //   if (!pagePath) return null

      //   const scriptFile = context.component!.params!.data.files.find(
      //     (file) => file.fileName === '.agent/display-mock/interactive-scripts.yaml'
      //   )
      //   if (!scriptFile) {
      //     return ele.querySelector('[data-zone-status]') ? [] : null
      //   }

      //   const locations = parseInteractiveScripts(decodeURIComponent(scriptFile.source))
      //     .filter((entry) => entry.page === pagePath)
      //     .flatMap((entry) => entry.locations)
      //   if (!locations.length) {
      //     return ele.querySelector('[data-zone-status]') ? [] : null
      //   }

      //   const res = locations.map(({ title, fileName, loc, scripts }) => {
      //     const locationKey = [pagePath, fileName, loc]
      //     const normalKey = JSON.stringify([...locationKey, 'normal'])
      //     return {
      //       title,
      //       items: [
      //         {
      //           title: commonLang.normal,
      //           activated: activeZoneStatusKey === normalKey,
      //           switchTo: () => {
      //             activeZoneStatusKey = normalKey
      //             resetWindowProxy()
      //           }
      //         },
      //         ...scripts.map(({ title: scriptTitle, script }, scriptIndex) => {
      //           const scriptKey = JSON.stringify([...locationKey, 'script', scriptTitle, scriptIndex])
      //           return {
      //             title: scriptTitle,
      //             activated: activeZoneStatusKey === scriptKey,
      //             switchTo: () => {
      //               activeZoneStatusKey = scriptKey
      //               try {
      //                 // 每次执行前恢复原值，场景之间互斥。
      //                 resetWindowProxy()
      //                 eval(script)
      //               } catch (e) {
      //                 console.error(e)
      //               }
      //             }
      //           }
      //         })
      //       ]
      //     }
      //   })

      //   return res
      // } catch (e) {
      //   console.log('@getZoneStatus', e)
      //   return null
      // }
    },
    '@createZoneStatus'(ele) {
      const iframeSrc = ele.dataset.iframeSrc
      const iframePath = ele.dataset.iframePath
      const pagePath = getPagePathWithBase(iframePath)

      agentTurnLifecycle.register(props.id, async () => {
        await notifyLocalPageStatuses([{ path: iframePath, src: iframeSrc }], true)
      })
      window._sandbox_.helpers.sendToAgent(props.id, {
        message: `参考「页面展示状态覆盖与交互脚本」，为路由「${pagePath}」对应的页面接入有意义的展示状态覆盖，并编写交互脚本。`,
      })
    }
  }
}
