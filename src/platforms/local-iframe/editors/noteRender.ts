import { getClosestDomLoc } from '../../../helpers/dom'
import context from '../../../mix/context'
import myContext from '../context'

export default {
  title: '',
  type: 'noteRender',
  value: {
    async get(params) {
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return null
      }
      const { files, codeLine } = loc
      const key = myContext.comment.buildKey(files, codeLine)

      return myContext.comment.get(key)
    },
    async set(params, value) {
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return null
      }
      const { files, codeLine } = loc
      const key = myContext.comment.buildKey(files, codeLine)

      const saved = await myContext.comment.set(key, value)
      if (!saved) {
        return null
      }

      context.component?.actions.notifyChanged("_noteRender", 'update', myContext.comment.getNotifyChangedValue())
    }
  }
}
