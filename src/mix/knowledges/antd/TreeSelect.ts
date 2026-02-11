export default {
  description: `树形选择器`,
  editors: {
    ':root': {
      title: '树形选择器',
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
  docs: require('./TreeSelect.md').default
}