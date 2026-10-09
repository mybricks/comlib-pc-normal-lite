// window.__lang_type__ = 'en'

function i18n<T>(langs: { zh: T; [language: string]: T | undefined }): T {
  return langs[window.__lang_type__ ?? 'zh'] || langs.zh
}

export default i18n
