export default {
  description: `导航菜单`,
  editors: {
    ':root': {
      title: '导航菜单',
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
    '.ant-menu-item.ant-menu-item-disabled': {
      title: '菜单项（禁用）',
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
    '.ant-menu-item:not(.ant-menu-item-disabled)': {
      title: '菜单项',
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
  docs: require('./Menu.md').default
}