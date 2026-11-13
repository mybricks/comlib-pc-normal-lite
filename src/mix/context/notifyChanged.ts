import {
  excludeWrapContainer,
  transformSummaryForNotifyChanged,
  type NewSummaryData,
} from '../../helpers/ai-code/transformForNotifyChanged'

/**
 * 将 YAML 中的元素定位键转换为设计器当前可消费的 DOM selector。
 * 新 YAML 使用 .className / #id，也支持 ".parent .child" 这类组合 selector；
 * 旧 JSDoc 使用不带前缀的 className，继续兼容。
 */
function transformElementSelector(selector: string): string {
  const value = selector.trim()
  if (value.startsWith('.') || value.startsWith('#')) {
    return value.replace(/\.([A-Za-z_][\w-]*)/g, '[data-zone-classnames*="$1"]')
  }
  const className = value.startsWith('.') ? value.slice(1) : value
  return `[data-zone-classnames*="${className}"]`
}

function createMainRefSelector(selector: string, fileName: string, componentName: string): string {
  const fileSelector = `[data-zone-filename="${fileName}"]`
  const widgetSelector = `[data-widget-name="${componentName}"]`
  const classSelector = transformElementSelector(selector)
  return excludeWrapContainer(
    selector === 'root'
      ? `${fileSelector}${widgetSelector}, ${fileSelector} ${widgetSelector}`
      : `${fileSelector}${widgetSelector}${classSelector}` +
        `, ${fileSelector}${widgetSelector} ${classSelector}` +
        `, ${fileSelector} ${widgetSelector}${classSelector}` +
        `, ${fileSelector} ${widgetSelector} ${classSelector}`,
  )
}

/** 普通设计器：通过文件和组件标记定位，并输出事件关联和组件文档。 */
export const transformNewFormatForNotifyChanged = (data: NewSummaryData, filename: string) =>
  transformSummaryForNotifyChanged(data, filename, {
    getRefSelector: (selector, { fileName, componentName }) =>
      createMainRefSelector(selector, fileName, componentName),
    getRelationRefSelector: name => `[data-widget-name="${name}"]:not([data-wrap-container])`,
    getDocRefSelector: ({ fileName, componentName }) => {
      const fileSelector = `[data-zone-filename="${fileName}"]`
      const widgetSelector = `[data-widget-name="${componentName}"]`
      return excludeWrapContainer(`${fileSelector}${widgetSelector}, ${fileSelector} ${widgetSelector}`)
    },
  })
