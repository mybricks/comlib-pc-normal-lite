import changeOrder from './changeOrder'
import updateText from './updateText'

export default function () {
  return {
    '@updateSegment'(ctx: any, type: string, options: any) {
      if (type === 'changeOrder') {
        changeOrder(options)
      } else if (type === 'updateText') {
        updateText(options)
      }
    }
  }
}