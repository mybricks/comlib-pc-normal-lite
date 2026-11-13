import { getClosestDomLoc, escapeCssAttributeValue } from '../../../helpers/dom'
import context from '../../../mix/context'
import myContext from '../context'

function scopeNoteRenderSelector(ele: Element, selector: string) {
  const page = ele.ownerDocument.defaultView?.frameElement?.closest('[data-iframe-path]')
  const iframePath = page?.getAttribute('data-iframe-path')
  if (iframePath == null) {
    return selector
  }

  const canvasSelector = `[data-iframe-path='${escapeCssAttributeValue(iframePath)}']`
  return `${canvasSelector} ${selector}`
}

export default {
  title: '',
  type: 'noteRender',
  value: {
    async get(params) {
      console.log('params', params)
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return null
      }
      const { files, codeLine } = loc
      const key = scopeNoteRenderSelector(params.focusArea.ele, myContext.comment.buildKey(files, codeLine))

      return myContext.comment.get(key)
    },
    async set(params, value) {
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return null
      }
      const { files, codeLine } = loc
      const key = scopeNoteRenderSelector(params.focusArea.ele, myContext.comment.buildKey(files, codeLine))

      const saved = await myContext.comment.set(key, value)
      if (!saved) {
        return null
      }

      context.component?.actions.notifyChanged("_noteRender", 'update', myContext.comment.getNotifyChangedValue())
    }
  }
}
