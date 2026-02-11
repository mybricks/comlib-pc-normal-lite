export default {
  description: `桑基图`,
  editors: {
    ':root': {
      title: '桑基图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./sankey.md').default
}