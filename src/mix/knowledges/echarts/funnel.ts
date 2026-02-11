export default {
  description: `漏斗图`,
  editors: {
    ':root': {
      title: '漏斗图',
      items: [
        {
          title: '样式',
          type: 'style',
          options: ['background', 'border'],
        }
      ]
    },
  },
  docs: require('./funnel.md').default
}