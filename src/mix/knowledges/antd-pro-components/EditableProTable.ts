export default {
  description: '可编辑表格 - 行编辑',
  editors: {
    ':root': {}
  },
  docs: require('./EditableProTable.md').default + `\n` + require('./ProTable.md').default + `\n` + require('../antd/Table.md').default
}