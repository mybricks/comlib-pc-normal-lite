export default {
  description: `进度条`,
  editors: {
    '.ant-progress-inner': {
      title: '进度条背景',
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
  docs: require('./Progress.md').default
}