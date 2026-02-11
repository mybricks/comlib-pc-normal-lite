export default {
  description: `分页`,
  editors: {
    ':root': {
      title: '分页',
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
    '.ant-pagination-item.ant-pagination-item-active a': {
      title: '当前页码',
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
    '.ant-pagination-item:not(.ant-pagination-item-active) a': {
      title: '页码',
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
    '.ant-pagination-options-size-changer .ant-select-selector': {
      title: '展示条数',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['padding', 'background', 'border'],
            }
          ]
        }
      ]
    },
    '.ant-pagination-next .ant-pagination-item-link': {
      title: '下一页',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'border'],
            }
          ]
        }
      ]
    },
    '.ant-pagination-prev .ant-pagination-item-link': {
      title: '上一页',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'border'],
            }
          ]
        }
      ]
    }
  },
  docs: require('./Pagination.md').default
}