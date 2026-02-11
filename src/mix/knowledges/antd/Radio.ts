export default {
  description: `单选框`,
  editors: {
    '.ant-radio-wrapper': {
      title: '选项',
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
    },
    '.ant-radio-button-wrapper': {
      title: '按钮式选项',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'background', 'border', 'padding'],
            }
          ]
        }
      ]
    }
  },
  docs: require('./Radio.md').default
}