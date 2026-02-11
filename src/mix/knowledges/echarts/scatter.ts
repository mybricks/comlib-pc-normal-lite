export default {
  description: `散点图`,
  editors: {
    ':root': {
      title: '散点图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./scatter.md').default
}