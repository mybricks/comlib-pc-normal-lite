import changeOrder from './changeOrder'
import updateText from './updateText'
import runDelete from './delete'

export default function () {
  return {
    '@updateSegment'(ctx: any, type: string, options: any) {
      if (type === 'cutTo') {
        return changeOrder(options)
      } else if (type === 'updateText') {
        updateText(options)
      } else if (type === 'delete') {
        runDelete(options)
      }
    }
  }
}