export default {
  description: `仪表盘`,
  editors: {
    ':root': {
      title: '仪表盘',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./gauge.md').default
}