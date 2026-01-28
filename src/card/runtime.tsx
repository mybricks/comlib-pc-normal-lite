import React from 'react';
import { Card } from 'antd';
import { Data, SlotIds } from './constants';

export default (props: RuntimeParams<Data>) => {
  const { data, slots } = props;

  return (
    <Card 
      title={data.title} 
      bordered={data.bordered}
      bodyStyle={{ padding: data.padding }}
    >
      {slots[SlotIds.Body]?.render()}
    </Card>
  );
};