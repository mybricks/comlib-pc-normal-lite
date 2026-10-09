import i18n from '../'
import version from './version'
import console from './console'

export default {
  ...version,
  ...console,
  sourceCode: i18n({
    zh: '源代码',
    en: 'Source Code'
  }),
  noMore: i18n({
    zh: '没有更多了',
    en: 'No more'
  }),
  confirm: i18n({
    zh: '确认',
    en: 'Confirm'
  }),
  cancel: i18n({
    zh: '取消',
    en: 'Cancel'
  }),
  clear: i18n({
    zh: '清空',
    en: 'Clear'
  }),
  save: i18n({
    zh: '保存',
    en: 'Save'
  }),
  delete: i18n({
    zh: '删除',
    en: 'Delete'
  }),
  export: i18n({
    zh: '导出',
    en: 'Export'
  }),
  import: i18n({
    zh: '导入',
    en: 'Import'
  }),
  updateFiles: i18n({
    zh: '更新文件',
    en: 'Updated files'
  }),
  rollbackFrom: i18n({
    zh: '回滚自',
    en: 'Rolled back from'
  }),
  aiFix: i18n({
    zh: '交给 AI 修复',
    en: 'Ask AI to fix'
  }),
  compileFailed: i18n({
    zh: '编译失败',
    en: 'Compilation failed'
  }),
  runtimeError: i18n({
    zh: '组件运行时错误',
    en: 'Component runtime error'
  }),
  viewAllErrors: i18n({
    zh: '查看所有错误',
    en: 'View all errors'
  }),
  details: i18n({
    zh: '详情',
    en: 'Details'
  }),
}
