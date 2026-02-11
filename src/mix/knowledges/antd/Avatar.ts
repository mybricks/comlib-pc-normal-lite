export default {
  description: `头像`,
  editors: {
    ':root': {
      title: '头像',
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
    }
  },
  docs: require('./Avatar.md').default
}