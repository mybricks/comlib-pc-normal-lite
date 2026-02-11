import { getStyleOptions } from "../utils";

export default {
  description: `统计数值`,
  editors: {
    '.ant-statistic-title': {
      title: '标题',
      items: [
        {
          title: '样式',
          type: 'style',
          options: getStyleOptions(['font', 'border', 'padding']),
        }
      ]
    },
    '.ant-statistic-content-value': {
      title: '内容',
      items: [
        {
          title: '样式',
          type: 'style',
          options: getStyleOptions(['font', 'border', 'padding']),
        }
      ]
    },
  },
  docs: require('./Statistic.md').default
}