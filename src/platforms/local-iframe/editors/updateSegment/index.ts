import updateText from './updateText'

export default function (_, type, options) {
  console.log('updateSegment', options)
  if (type === 'updateText') {
    return updateText(options)
  }
  //   if (type === 'cutTo') {
  //     return changeOrder(options)
  //   } else if (type === 'updateText') {
  //     return updateText(options)
  //   } else if (type === 'delete') {
  //     return runDelete(options)
  //   } else if (type === 'insert') {
  //     return insert(options)
  //   }
}