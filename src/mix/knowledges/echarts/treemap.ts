export default {
  description: `矩形树图`,
  editors: {
    ':root': {
      title: '矩形树图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./treemap.md').default
}