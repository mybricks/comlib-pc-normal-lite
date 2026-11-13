import { escapeCssAttributeValue } from '../../../helpers/dom'
import myContext from '../context'

export default async function (hookContext) {
  const ele = hookContext.focusArea.ele as Element
  const page = ele.closest('[data-iframe-path]')
    ?? ele.ownerDocument.defaultView?.frameElement?.closest('[data-iframe-path]')
  const iframePath = page?.getAttribute('data-iframe-path')
  if (iframePath == null) {
    return []
  }

  const prefix = `[data-iframe-path='${escapeCssAttributeValue(iframePath)}']`
  const comments = await myContext.comment.getMap()

  return Object.entries(comments)
    .filter(([key, value]) => key.startsWith(prefix) && value?.length)
    .map(([key, value]) => ({
      refSelector: key.slice(prefix.length).trimStart(),
      ...value[0],
      type: value.find(({ type }) => type === 'todo') ? 'todo' : 'default'
    }))
}
