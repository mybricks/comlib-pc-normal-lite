export default {
  description: `旭日图`,
  editors: {
    ':root': {
      title: '旭日图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./sunburst.md').default
}