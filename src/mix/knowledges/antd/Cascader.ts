export default {
  description: `级联选择器`,
  editors: {
    ':root': {
      title: '级联选择器',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'font', 'border'],
            }
          ]
        }
      ]
    },
  },
  docs: require('./Cascader.md').default
}