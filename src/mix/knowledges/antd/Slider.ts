export default {
  description: `滑块`,
  editors: {
    ':root': {
      title: '全部区间',
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
    '.ant-slider-track': {
      title: '有值区间',
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
  docs: require('./Slider.md').default
}