export default {
  description: `折叠面板`,
  editors: {
    ':root': {
      title: '折叠面板',
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
    '.ant-collapse-header': {
      title: '头部区域',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'background', 'padding'],
            }
          ]
        }
      ]
    },
    '.ant-collapse-content-box': {
      title: '内容区域',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'background', 'padding'],
            }
          ]
        }
      ]
    }
  },
  docs: require('./Collapse.md').default
}