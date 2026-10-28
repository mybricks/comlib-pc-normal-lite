import { getClosestDomLoc } from '../../../helpers/dom'

function getUrl({ editor, path }) {
  return `${editor}://file${path[0] === '/' ? '' : '/'}${path}`
}

export default function (params) {
  const loc = getClosestDomLoc(params.focusArea.ele)

  if (!loc) {
    return false
  }

  // window.location.assign(getUrl({
  //   editor: 'vscode',
  //   path: `${loc.files.jsx}:${loc.codeLine.start}`
  // }))
  // 客户端
  window.open(getUrl({
    editor: 'vscode',
    path: `${loc.files.jsx}:${loc.codeLine.start}`
  }), '_blank')

  return false
}
