export default function (hookContext, params) {
  type AuditPageOptionKey = 'events' | 'services' | 'crScope' | 'store' | 'crComplete';
  type AuditPageOptions = Partial<Record<AuditPageOptionKey, boolean>>;

  const auditPageOptionLabels: Array<[AuditPageOptionKey, string]> = [
    ['events', '事件'],
    ['services', '接口'],
    ['crScope', '变更影响'],
    ['store', '状态'],
    // ['crComplete', '完成度']
  ];

  function getAuditPageMessage(options: AuditPageOptions = {}) {
    return auditPageOptionLabels
      .filter(([key]) => options[key])
      .map(([, label]) => label)
      .join('、');
  }
  const {
    id,
    options = {},
    onComplete,
    onError,
  } = params as {
    id: string;
    options?: AuditPageOptions;
    onComplete: () => void;
    onError: () => void;
  };

  const message = getAuditPageMessage(options);
  const detail = message ? `的${message}文档` : '文档';
  const ele = hookContext.focusArea.ele;

  (window as any)._sandbox_?.helpers?.sendToAgent?.(hookContext.id, {
    message: `更新页面「${id}」${detail}`,
    extra: {
      onComplete,
      onError,
    },
  });
}