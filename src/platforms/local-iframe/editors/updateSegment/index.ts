import updateText from './updateText'
import deleteDom from './deleteDom'
import moveDom from './moveDom'
import duplicate from './duplicate'

export default function (_, type, options) {
  console.log('updateSegment', { type, options })
  if (type === 'updateText') {
    return updateText(options)
  } else if (type === 'delete') {
    return deleteDom(options)
  } else if (type === 'cutTo') {
    return moveDom(options)
  } else if (type === 'duplicate') {
    return duplicate(options)
  }
  // type === 'insert' 组件拖入
}