export default {
  description: `图片`,
  editors: {
    ':root': {
      title: '图片',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['border', 'padding'],
            }
          ]
        }
      ]
    },
  },
  docs: require('./Image.md').default
}