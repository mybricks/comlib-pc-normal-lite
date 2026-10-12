import { getClosestDomLoc } from '../../../helpers/dom'
import myContext from '../context'
import { randomUUID } from '../../../mix/utils/uuid'
import { agentTurnLifecycle } from '../../../mix/sandbox/agent-turn-lifecycle'
import { executeLocalShellCommand, readLocalFiles } from '../sandbox'

export default function () {
  return {
    '@getDoc'(params) {
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return myContext.doc.get('')
      }
      const { files, codeLine } = loc
      const key = myContext.doc.buildKey(files, codeLine)
      return myContext.doc.get(key)
    },
    '@updateDoc'(params, { onComplete }) {
      const ele = params.focusArea.ele
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return
      }
      const { files, codeLine } = loc
      const key = myContext.doc.buildKey(files, codeLine)
      const chipId = randomUUID()
      const analyzeFilePath = `.lingchuang/temp/analyse-${randomUUID().slice(0, 5)}.md`
      const label = ele.tagName.toLowerCase()
      const chip = {
        id: chipId,
        label,
        type: 'dom',
        data: {
          ele,
        }
      }

      const agentMessage = `[$mbs-template:analyze-selection] 分析下这个选择区域 [[chip:${chip.id}]]，整理出分析报告markdown 放到 ${analyzeFilePath} 里，注意：这是一次性报告，可以重复写入不同的报告，不论之前是否存在，直接写入即可，写入后会展示在设计器窗口编辑区的右侧`
      agentTurnLifecycle.register(params.id, async (turn) => {
        if (turn?.status !== 'success') return
        const analyzeFile = (await readLocalFiles([analyzeFilePath]))[0]
        const result = analyzeFile?.content ?? ''

        if (analyzeFile) {
          executeLocalShellCommand(`rm -f "${analyzeFilePath}"`)
        }

        const doc = {
          createTime: new Date().getTime(),
          content: result
        }

        if (result) {
          myContext.doc.set(key, doc)
        }
        await onComplete(doc)
      })
      window._sandbox_.helpers.sendToAgent(params.id, {
        message: agentMessage,
        meta: {
          chips: [chip],
        },
        aiRole: "fast",
      })
    },
  }
}
