import changeOrder from './changeOrder'
import updateText from './updateText'
import runDelete from './delete'

export default function () {
  return {
    '@updateSegment'(ctx: any, type: string, options: any) {
      console.log('[type]', type)
      if (type === 'cutTo') {
        return changeOrder(options)
      } else if (type === 'updateText') {
        return updateText(options)
      } else if (type === 'delete') {
        return runDelete(options)
      }
    }
  }
}