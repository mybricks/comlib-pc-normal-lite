export default {
  description: `步骤条`,
  editors: {
    ':root': {
      title: '步骤条',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'font'],
            }
          ]
        }
      ]
    },
    '.ant-steps-item .ant-steps-item-title': {
      title: '步骤标题',
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
    '.ant-steps-item .ant-steps-item-icon': {
      title: '步骤图标',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'font'],
            }
          ]
        }
      ]
    },
    '.ant-steps-item .ant-steps-item-description': {
      title: '步骤描述',
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
    '.ant-steps-item-active .ant-steps-item-title': {
      title: '当前步骤标题',
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
    '.ant-steps-item-active .ant-steps-item-icon': {
      title: '当前步骤图标',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'font'],
            }
          ]
        }
      ]
    },
    '.ant-steps-item-active .ant-steps-item-description': {
      title: '当前步骤描述',
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
  },
  docs: require('./Steps.md').default
}