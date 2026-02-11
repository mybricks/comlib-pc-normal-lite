export default {
  description: `文本段落`,
  editors: {
    ':root': {
      title: '文本段落',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'background', 'border'],
            }
          ]
        }
      ]
    },
  },
  docs: require('./Typography.md').default
}