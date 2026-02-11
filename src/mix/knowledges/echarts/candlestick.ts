export default {
  description: `K线图`,
  editors: {
    ':root': {
      title: 'K线图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./candlestick.md').default
}