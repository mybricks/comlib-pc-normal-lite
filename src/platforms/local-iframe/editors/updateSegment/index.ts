import updateText from './updateText'
import deleteDom from './deleteDom'
import moveDom from './moveDom'
import duplicate from './duplicate'
import insert from './insert'

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
  } else if (type === 'insert') {
    return insert(options)
  }
}
