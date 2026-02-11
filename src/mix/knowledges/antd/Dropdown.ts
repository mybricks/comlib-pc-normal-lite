export default {
  description: `下拉菜单`,
  editors: {
    '.ant-dropdown-trigger': {
      title: '下拉菜单',
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
  },
  docs: require('./Dropdown.md').default
}