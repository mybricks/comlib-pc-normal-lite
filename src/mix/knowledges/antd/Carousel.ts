export default {
  description: `走马灯`,
  editors: {
    ':root': {
      title: '走马灯',
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
  },
  docs: require('./Carousel.md').default
}