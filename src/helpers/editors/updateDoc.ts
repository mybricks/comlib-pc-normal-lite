import { randomUUID } from '../../mix/utils/uuid'
import { agentTurnLifecycle } from '../../mix/sandbox/agent-turn-lifecycle'

export type AnalysisDoc = {
  createTime: number
  content: string
}

type UpdateDocOptions = {
  tempDirectory: string
  /** 返回 undefined 表示临时报告不存在。 */
  readReport: (filePath: string) => Promise<string | undefined>
  removeReport: (filePath: string) => Promise<unknown>
  saveDoc: (doc: AnalysisDoc) => Promise<unknown>
}

/** 平台负责报告读写和文档存储，共享选区分析的 Agent 生命周期。 */
export function updateDoc(
  params: { id: string; focusArea: { ele: Element } },
  { onComplete }: { onComplete: (doc: AnalysisDoc) => unknown | Promise<unknown> },
  options: UpdateDocOptions,
) {
  const ele = params.focusArea.ele
  const chip = {
    id: randomUUID(),
    label: ele.tagName.toLowerCase(),
    type: 'dom',
    data: { ele },
  }
  const filePath = `${options.tempDirectory}/analyse-${randomUUID().slice(0, 5)}.md`
  const message = `[$mbs-template:analyze-selection] 分析下这个选择区域 [[chip:${chip.id}]]，整理出分析报告markdown 放到 ${filePath} 里。\n注意：这是一次性报告，不论之前是否存在，直接写入即可，写入后会展示在设计器窗口编辑区的右侧，之后会被自动清理。`

  agentTurnLifecycle.register(params.id, async (turn) => {
    if (turn?.status !== 'success') return

    const report = await options.readReport(filePath)
    if (report !== undefined) {
      void options.removeReport(filePath).catch((error) => {
        console.warn('[updateDoc] failed to remove temporary report', filePath, error)
      })
    }

    const doc: AnalysisDoc = {
      createTime: new Date().getTime(),
      content: report ?? '',
    }
    if (doc.content) {
      void options.saveDoc(doc).catch((error) => {
        console.warn('[updateDoc] failed to save document', filePath, error)
      })
    }
    await onComplete(doc)
  })

  window._sandbox_.helpers.sendToAgent(params.id, {
    message,
    meta: { chips: [chip] },
    aiRole: 'fast',
  })
}
