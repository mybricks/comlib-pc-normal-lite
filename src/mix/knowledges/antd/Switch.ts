export default {
  description: `开关`,
  editors: {
    ':root': {
      title: '开关',
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
  docs: require('./Switch.md').default
}