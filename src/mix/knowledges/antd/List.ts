export default {
  description: `列表`,
  editors: {
    ':root': {
      title: '列表',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'border', 'padding'],
            }
          ]
        }
      ]
    },
    '.ant-list-item': {
      title: '列表项',
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
    },
  },
  docs: require('./List.md').default
}