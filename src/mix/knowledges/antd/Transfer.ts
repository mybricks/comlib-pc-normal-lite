export default {
  description: `穿梭框`,
  editors: {
    ':root': {
      title: '穿梭框',
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
    '.ant-transfer-list-header': {
      title: '穿梭框顶部',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'padding', 'border'],
            }
          ]
        }
      ]
    },
    '.ant-transfer-list-header-selected': {
      title: '计数',
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
    '.ant-transfer-list-header-title': {
      title: '标题',
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
    '.ant-transfer-list-search': {
      title: '搜索框',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'border', 'background'],
            }
          ]
        }
      ]
    },
    '.ant-transfer-operation .ant-btn': {
      title: '操作项',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'border', 'background'],
            }
          ]
        }
      ]
    }
  },
  docs: require('./Transfer.md').default
}