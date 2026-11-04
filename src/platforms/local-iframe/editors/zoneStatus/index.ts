import myContext from '../../context'
import { agentTurnLifecycle } from '../../../../mix/sandbox/agent-turn-lifecycle'
import { notifyLocalPageStatuses } from '../../runtime/page-status'
import { getPagePathWithBase } from '../../runtime/page-path'

export default function(props) {
  return {
    async '@createZoneStatus'(ele) {
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
