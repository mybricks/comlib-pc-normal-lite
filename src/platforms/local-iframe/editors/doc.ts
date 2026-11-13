import { getClosestDomLoc } from '../../../helpers/dom'
import myContext from '../context'
import { updateDoc } from '../../../helpers/editors/updateDoc'
import { executeLocalShellCommand, readLocalFiles } from '../sandbox'

export default function () {
  return {
    '@getDoc'(params) {
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return myContext.doc.get('')
      }
      const { files, codeLine } = loc
      const key = myContext.doc.buildKey(files, codeLine)
      return myContext.doc.get(key)
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
