export default {
  description: `盒须图`,
  editors: {
    ':root': {
      title: '盒须图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./boxplot.md').default
}