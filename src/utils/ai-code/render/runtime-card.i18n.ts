import getI18n from '../../../helpers/i18n'

export const runtimeCardI18n = {
  generateFailed: () => getI18n({ zh: '生成失败', en: 'Generation failed' }),
  error: () => getI18n({ zh: '错误', en: 'Error' }),
  unknown: () => getI18n({ zh: '未知错误', en: 'Unknown error' }),
  runtime: () => getI18n({ zh: '运行时', en: 'Runtime' }),
  runtimeError: (message: string) => getI18n({ zh: `当前组件运行时出错：${message}，以下是错误堆栈信息：\n`, en: `This component encountered a runtime error: ${message}. Stack trace:\n` }),
  errors: () => getI18n({ zh: '当前组件出现了以下错误：\n', en: 'This component encountered the following errors:\n' }),
  errorDetail: (detail: string) => getI18n({ zh: `当前组件出错了，${detail}`, en: `This component encountered an error: ${detail}` }),
}
