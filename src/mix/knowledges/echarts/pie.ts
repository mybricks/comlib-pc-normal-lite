export default {
  description: `饼图`,
  editors: {
    ':root': {
      title: '饼图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./pie.md').default
}