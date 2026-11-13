import { getClosestDomLoc } from '../../../helpers/dom'
import myContext from '../context'
import { updateDoc } from '../../../helpers/editors/updateDoc'
import { executeLocalShellCommand, readLocalFiles } from '../sandbox'

export default function () {
  return {
    '@getDoc'(params, valueKeys) {
      const ele = params.focusArea.ele as Element
      const isCanvas = ele.getAttribute('data-zone-type') === 'page' || !!ele.getAttribute('data-canvas-tag')
      // DOM 位于 iframe 内，页面路由来自宿主中的 iframe 容器。
      const page = isCanvas ? ele : ele.ownerDocument.defaultView?.frameElement?.closest('[data-iframe-path]')
      const res = myContext.audit.get({
        path: page?.getAttribute('data-iframe-path') ?? undefined,
        type: isCanvas ? 'canvas' : 'dom',
        loc: isCanvas ? undefined : getClosestDomLoc(ele),
        parentLoc: isCanvas ? undefined : ele.getAttribute('data-parent-loc'),
        valueKeys,
      })
      return res
    },
    '@updateDoc'(params, { onComplete }) {
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return
      }
      const { files, codeLine } = loc
      const key = myContext.doc.buildKey(files, codeLine)
      return updateDoc(params, { onComplete }, {
        tempDirectory: '.lingchuang/temp',
        async readReport(filePath) {
          const file = (await readLocalFiles([filePath]))[0]
          return file?.content
        },
        async removeReport(filePath) {
          return executeLocalShellCommand(`rm -f "${filePath}"`)
        },
        async saveDoc(doc) {
          return myContext.doc.set(key, doc)
        },
      })
    },
  }
}
