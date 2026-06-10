import createSetStyleHandler from './helpers/createSetStyleHandler'

export default function () {
  return {
    /** 画布上各种可视化调整 */
    '@setStyle': createSetStyleHandler(
      (_ctx, params) => params.ele,
      (_ctx, params) => params.style,
    ),
  }
}
