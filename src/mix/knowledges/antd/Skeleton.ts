export default {
  description: `骨架屏`,
  editors: {
    '.ant-skeleton': {
      title: '骨架屏',
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
  },
  docs: require('./Skeleton.md').default
}