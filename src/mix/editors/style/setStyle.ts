import createSetStyleHandler from './helpers/createSetStyleHandler'

export default function () {
  return {
    /** 画布上各种可视化调整 */
    '@setStyle': createSetStyleHandler(
      (_ctx, params) => params.ele,
      (_ctx, params) => {
        return Object.entries(params.style).reduce((pre, [key, value]: any) => {
          pre[key] = Math.max(value, 0)
          return pre;
        }, {})
      },
    ),
  }
}
