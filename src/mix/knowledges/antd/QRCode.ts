export default {
  description: `二维码`,
  editors: {
    ':root': {
      title: '二维码',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'border', 'padding'],
            }
          ]
        }
      ]
    },
  },
  docs: require('./QRCode.md').default
}