export default {
  description: `上传`,
  editors: {
    '.ant-upload-wrapper .ant-upload button': {
      title: '上传按钮',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'border', 'padding', 'background'],
            }
          ]
        }
      ]
    },
    '.ant-upload-wrapper .ant-upload-select': {
      title: '上传卡片',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['border', 'background'],
            }
          ]
        }
      ]
    },
    '.ant-upload-select button div': {
      title: '提示文本',
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
    '.ant-upload-select button .anticon': {
      title: '提示图标',
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
    '.ant-upload-wrapper .ant-upload-list-item-done': {
      title: '已上传文件',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['border', 'padding', 'background'],
            }
          ]
        }
      ]
    },
  },
  docs: require('./Upload.md').default
}