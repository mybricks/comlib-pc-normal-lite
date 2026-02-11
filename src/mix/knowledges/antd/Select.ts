export default {
  description: `下拉选择器`,
  editors: {
    ':root': {
      title: '下拉选择器',
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
    // '.ant-select:not(.ant-select-disabled):hover .ant-select-selector': {
    //   title: '下拉选择器悬浮态',
    //   style: [
    //     {
    //       items: [
    //         {
    //           title: '样式',
    //           options: ['font', 'background', 'border'],
    //         }
    //       ]
    //     }
    //   ]
    // },
    '.ant-select-item.ant-select-item-option': {
      title: '下拉项',
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
  docs: require('./Select.md').default
}