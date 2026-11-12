import { auditPageI18n } from '../../../mix/editors/audit-page.i18n'
import { agentTurnLifecycle } from '../../../mix/sandbox/agent-turn-lifecycle'

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

  agentTurnLifecycle.register(hookContext.id, (turn) => {
    if (turn?.status === 'success') {
      return onComplete()
    }
    return onError()
  })
  ;(window as any)._sandbox_?.helpers?.sendToAgent?.(hookContext.id, {
    message: agentMessage,
    aiRole: 'fast',
  })
}
