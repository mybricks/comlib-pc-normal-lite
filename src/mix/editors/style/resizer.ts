import createSetStyleHandler from './helpers/createSetStyleHandler'

export default function() {
  let style: Record<string, number> = {}

  const handler = createSetStyleHandler(
    (ctx) => ctx.focusArea.ele,
    () => style,
  )

  return {
    type: '_resizer',
    value: {
      get() {},
      set(params: any, value: any, status: any) {
        const { state } = status
        const ctx = params
        if (state === 'ing') {
          style = Object.entries(value).reduce((pre, [key, value]: any) => {
            pre[key] = Math.max(value, 0)
            return pre;
          }, {})
        }
        handler(ctx, status)
      },
    },
  }
}