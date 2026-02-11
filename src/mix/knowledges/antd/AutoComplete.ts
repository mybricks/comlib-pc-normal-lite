export default {
  description: `自动完成输入框`,
  editors: {
    ':root': {
      title: '输入框',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'font', 'border'],
            }
          ]
        }
      ]
    }
  },
  docs: require('./AutoComplete.md').default
}