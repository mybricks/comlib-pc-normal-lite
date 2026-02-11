export default {
  description: `数字输入框`,
  editors: {
    ':root': {
      title: '数字输入框',
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
  docs: require('./InputNumber.md').default
}