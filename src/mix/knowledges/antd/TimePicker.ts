export default {
  description: `时间选择器`,
  editors: {
    ':root': {
      title: '时间选择器',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'font', 'border', 'padding'],
            }
          ]
        }
      ]
    },
  },
  docs: require('./TimePicker.md').default
}