export default {
  description: `表格组件`,
  editors: {
    ':root': {
      title: '表格',
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
    '.ant-table-thead': {
      title: '表头',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'background', 'border', 'padding'],
            }
          ]
        }
      ]
    },
    '.ant-table-thead .ant-table-cell': {
      title: '列',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'background', 'border', 'padding'],
            }
          ]
        }
      ]
    },
    ...(require('./Pagination.ts')?.default?.editors ?? {}),
  },
  docs: require('./Table.md').default + require('./Pagination.md').default,
}