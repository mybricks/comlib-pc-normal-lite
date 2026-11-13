import { auditPageI18n } from '../../../mix/editors/audit-page.i18n'
import { agentTurnLifecycle } from '../../../mix/sandbox/agent-turn-lifecycle'
import context from '../context'
import { refreshLocalGraph } from '../sandbox'

export default function (hookContext, params) {
  type AuditPageOptionKey = 'events' | 'services' | 'crScope' | 'store' | 'crComplete';
  type AuditPageOptions = Partial<Record<AuditPageOptionKey, boolean>>;

  const auditPageOptionLabels: Array<[AuditPageOptionKey, string]> = [
    ['events', auditPageI18n.events()],
    ['services', auditPageI18n.services()],
    ['crScope', auditPageI18n.crScope()],
    ['store', auditPageI18n.store()],
    // ['crComplete', '完成度']
  ];

  function getAuditPageMessage(options: AuditPageOptions = {}) {
    return auditPageOptionLabels
      .filter(([key]) => options[key])
      .map(([, label]) => label);
  }
  const {
    // id,
    options = {},
    onComplete,
    onError,
  } = params as {
    // id: string;
    options?: AuditPageOptions;
    onComplete: () => void;
    onError: () => void;
  };

  const message = getAuditPageMessage(options);
  const ele = hookContext.focusArea.ele;
  const iframePath = ele.dataset.iframePath
  const agentMessage = auditPageI18n.pageMessage(iframePath, message);

  return new Promise<Awaited<ReturnType<typeof context.audit.get>>>((resolve, reject) => {
    agentTurnLifecycle.register(hookContext.id, async (turn) => {
      try {
        if (turn?.status !== 'success') {
          throw new Error('Page audit failed')
        }
        // Agent 可能通过 shell 更新 YAML，完成后必须主动读取最新 graph。
        await refreshLocalGraph()
        const result = await context.audit.get({
          path: iframePath,
          type: 'canvas',
          valueKeys: ['events', 'services', 'state', 'store', 'jsDoc'],
        })
        onComplete()
        resolve(result)
      } catch (error) {
        reject(error)
        onError()
      }
    })
    ;(window as any)._sandbox_?.helpers?.sendToAgent?.(hookContext.id, {
      message: agentMessage,
      aiRole: 'fast',
    })
  })
}
