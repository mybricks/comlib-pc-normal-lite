export default {
  description: `柱状图`,
  editors: {
    ':root': {
      title: '柱状图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./column.md').default
}