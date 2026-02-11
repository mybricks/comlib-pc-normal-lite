export default {
  description: `徽标数`,
  editors: {
    ':root': {
      title: '徽标',
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
    '.shape': {
      title:'徽标背景',
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
    },
    '.ant-scroll-number': {
      title:'滚动数字',
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
    }

  },
  docs: require('./Badge.md').default
}