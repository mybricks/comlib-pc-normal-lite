export default {
  description: '可编辑表格 - 单元格编辑',
  editors: {
    ':root': {}
  },
  docs: require('./CellEditorTable.md').default + require('./EditableProTable.md').default + `\n` + require('./ProTable.md').default + `\n` + require('../antd/Table.md').default
}