import React from 'react';
import { Line } from '@ant-design/charts';
import { Data, MockData } from './constants';
import EmptyWrap from '../components/emptyWrap';

const changeMockDataField = (
  arr: Array<Record<string, any>>,
  Field: { xField: string; yField: string; seriesField?: string },
  defaultKey?: { x?: string; y?: string; category?: string }
): Array<Record<string, any>> => {
  const { xField, yField, seriesField } = Field;
  const { x = 'year', y = 'value', category = 'category' } = defaultKey || {};

  return arr.map((item) => ({
    [xField]: item[x],
    [yField]: item[y],
    [seriesField]: item?.[category]
  }));
};

export default function (props: RuntimeParams<Data>) {
  const { data, env, style } = props;

  const chartData = env.edit
    ? changeMockDataField(MockData[data.subType], data.config)
    : [];

  if (!env.edit && chartData.length === 0) {
    return (
      <EmptyWrap
        style={{ width: style.width, height: style.height }}
        emptyText={data.emptyText}
        useEmpty={data.useEmpty}
        emptyImage={data.emptyImage}
      />
    );
  }

  return (
    <Line
      style={{ width: style.width, height: style.height }}
      {...data.config}
      data={chartData}
      key={env.edit ? JSON.stringify(data.config) : undefined}
    />
  );
}