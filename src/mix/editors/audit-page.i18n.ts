import getI18n from '../../helpers/i18n'

function auditMessage(target: string, labels: string[]): string {
  return getI18n({
    zh: `使用 audit-power 来更新${target}${labels.length ? `的${labels.join('、')}文档` : '文档'}`,
    en: `Use audit-power to update ${labels.length ? `the ${labels.join(', ')} documentation` : 'the documentation'} for ${target}`,
  })
}

export const auditPageI18n = {
  events: () => getI18n({ zh: '事件', en: 'events' }),
  services: () => getI18n({ zh: '接口', en: 'APIs' }),
  crScope: () => getI18n({ zh: '变更影响', en: 'change impact' }),
  store: () => getI18n({ zh: '状态', en: 'state' }),
  pageMessage: (path: string, labels: string[]) => auditMessage(getI18n({ zh: `页面「${path}」`, en: `page "${path}"` }), labels),
  message: auditMessage,
}
