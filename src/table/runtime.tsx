import React from 'react';
import { Table } from 'antd';
import { DefaultRowKey } from './constants';
import { Data } from './types';

export default function (props: RuntimeParams<Data>) {
  const { data } = props;

  const columns = data.columns
    ?.filter((col) => col.visible !== false)
    ?.map((col) => ({
      title: col.title,
      dataIndex: col.dataIndex,
      key: col.key,
      width: col.width
    }));

  return (
    <Table
      className="mybricks-table"
      columns={columns}
      dataSource={data.dataSource || []}
      rowKey={data.rowKey || DefaultRowKey}
      pagination={false}
    />
  );
}
