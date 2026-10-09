import i18n from '../'

export default {
  version: i18n({
    zh: '版本',
    en: 'Version'
  }),
  'version.empty': i18n({
    zh: '暂无版本',
    en: 'No versions'
  }),
  'version.type.init': i18n({
    zh: '初始版本',
    en: 'Initial Version'
  }),
  'version.type.manual': i18n({
    zh: '手动编辑',
    en: 'Manual Edit'
  }),
  'version.type.ai': i18n({
    zh: 'AI 编辑',
    en: 'AI Edit'
  }),
  'version.type.rollback': i18n({
    zh: '回滚',
    en: 'Rollback'
  }),
  'version.type.rollback.tips': i18n({
    zh: '确认回滚到该版本？该版本之后的内容将被删除且不可撤销。',
    en: 'Are you sure you want to roll back to this version? Content after this version will be deleted and cannot be undone.'
  })
}
