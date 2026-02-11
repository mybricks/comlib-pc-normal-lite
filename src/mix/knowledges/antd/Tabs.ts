export default {
  description: `标签页`,
  editors: {
    ':root': {
      title: '标签页',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'border'],
            }
          ]
        }
      ]
    },
    '.ant-tabs-tab': {
      title: '标签项',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'background', 'padding', 'border'],
            }
          ]
        }
      ]
    },
    '.ant-tabs-tab.ant-tabs-tab-active': {
      title: '选中项',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'background', 'padding', 'border'],
            }
          ]
        }
      ]
    },
    '.ant-tabs-ink-bar': {
      title: '指示条',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background'],
            }
          ]
        }
      ]
    },
    '.ant-tabs-extra-content': {
      title: '额外区域',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'padding', 'font'],
            }
          ]
        }
      ]
    }
  },
  docs: require('./Tabs.md').default
}