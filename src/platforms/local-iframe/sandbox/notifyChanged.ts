import {
  excludeWrapContainer,
  transformSummaryForNotifyChanged,
  type NewSummaryData,
} from '../../../helpers/ai-code/transformForNotifyChanged'

function createLocalIframeRefSelector(selector: string, fileName: string): string | undefined {
  if (selector === 'root') {
    return 'body'
  }
  const fileSelector = `[data-loc*="${fileName}"]`
  const value = selector.trim()
  const classSelector = (value.startsWith('.') || value.startsWith('#'))
    ? value.replace(/\.([A-Za-z_][\w-]*)/g, '[class*="$1"]')
    : `[class*="${value}"]`
  return excludeWrapContainer(`${fileSelector}${classSelector}, ${fileSelector} ${classSelector}`)
}

/** 本地 iframe：通过源码位置和原生 class 定位，root 对应 body。 */
export const transformLocalIframeFormatForNotifyChanged = (data: NewSummaryData, filename: string) =>
  transformSummaryForNotifyChanged(data, filename, {
    getRefSelector: (selector, { fileName }) => createLocalIframeRefSelector(selector, fileName),
    getDocRefSelector: ({ fileName }) =>
      excludeWrapContainer(`[data-loc*="${fileName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`),
  })
