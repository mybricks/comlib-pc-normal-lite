import updateText from './updateText'
import deleteDom from './deleteDom'
import moveDom from './moveDom'

export default function (_, type, options) {
  console.log('updateSegment', { type, options })
  if (type === 'updateText') {
    return updateText(options)
  } else if (type === 'delete') {
    return deleteDom(options)
  } else if (type === 'cutTo') {
    return moveDom(options)
  }
  // type === 'insert' 组件拖入
}