export default {
  description: `日期选择器`,
  editors: {
    ':root': {
      title: '日期选择器',
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
    '.anticon-calendar': {
      title: '图标',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font'],
            }
          ]
        }
      ]
    }
  },
  docs: require('./DatePicker.md').default
}