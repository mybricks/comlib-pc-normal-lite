import { Data } from './types';
import { DefaultRowKey } from './constants';

export default function ({ data }: RuntimeParams<Data>) {
  // 过滤可见列并生成列配置
  const columns = (data.columns || [])
    .filter((col) => col.visible !== false)
    .map((col) => ({
      title: col.title,
      dataIndex: col.dataIndex,
      key: col.key,
      width: col.width
    }));

  const columnsStr = JSON.stringify(columns, null, 2);
  const dataSourceStr = JSON.stringify(data.dataSource || [], null, 2);
  const rowKey = data.rowKey || DefaultRowKey;

  const jsx = `<Table
  className="mybricks-table"
  columns={${columnsStr}}
  dataSource={${dataSourceStr}}
  rowKey="${rowKey}"
  pagination={false}
/>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Table']
      }
    ],
    jsx,
    style: '',
    js: ''
  };
}
