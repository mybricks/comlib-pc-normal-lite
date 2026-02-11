export default {
  description: `热力图`,
  editors: {
    ':root': {
      title: '热力图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./heatmap.md').default
}