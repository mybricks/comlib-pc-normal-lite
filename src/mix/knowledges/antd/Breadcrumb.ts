export default {
  description: `面包屑`,
  editors: {
    '.ant-breadcrumb-link': {
      title: '链接',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font','background'],
            }
          ]
        }
      ]
    },
  },
  docs: require('./Breadcrumb.md').default
}