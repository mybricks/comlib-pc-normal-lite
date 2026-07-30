import changeOrder from './changeOrder'
import updateText from './updateText'
import runDelete from './delete'
import context from '../../context'

let updateSegments: any = []

export default function () {
  return {
    '@updateSegment'(ctx: any, type: string, options: any) {
      updateSegments.push(() => {
        if (type === 'cutTo') {
          return changeOrder(options)
        } else if (type === 'updateText') {
          return updateText(options)
        } else if (type === 'delete') {
          return runDelete(options)
        }
      })

      return {
        type: 'success'
      }
    },
    '@commitUserActions'() {
      let message = ''
      let chips = []

      updateSegments.forEach((fn) => {
        const res = fn()
        if (res.type === 'promise') {
          message += res.message
          chips = chips.concat(res.chips)
        }
        return res
      })

      updateSegments = []

      if (message) {
        const componentId = context.component!.params.id
        window._sandbox_?.helpers?.sendToAgent?.(componentId, {
          message,
          meta: {
            chips
          }
        })
      }
    },
    '@cancelUserActions'(...args) {
      updateSegments = []
    }
  }
}