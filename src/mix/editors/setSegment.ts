// 1、data-zone-order-editable
// 2、@setSegment(ctx,{fromDom,toDom,type})

export default function () {
  return {
    '@setSegment'(ctx, options) {
      console.log('@setSegment', {ctx, options})
    }
  }
}