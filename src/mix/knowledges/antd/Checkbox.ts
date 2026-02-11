export default {
  description: `复选框`,
  editors: {
    ':root': {
      title: '复选框',
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
  },
  docs: require('./Checkbox.md').default
}