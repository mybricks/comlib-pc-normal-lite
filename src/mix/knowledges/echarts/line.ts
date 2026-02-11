export default {
  description: `折线图`,
  editors: {
    ':root': {
      title: '折线图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./line.md').default
}