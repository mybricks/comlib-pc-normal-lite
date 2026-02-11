export default {
  description: `雷达图`,
  editors: {
    ':root': {
      title: '雷达图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./radar.md').default
}