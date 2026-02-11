export default {
  description: `树图`,
  editors: {
    ':root': {
      title: '树图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./tree.md').default
}