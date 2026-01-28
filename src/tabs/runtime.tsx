import React from 'react';
import { Tabs } from 'antd';
import { Data, SlotIds } from './constants';

const { TabPane } = Tabs;

export default function ({ data, slots }: RuntimeParams<Data>) {
  const handleChange = (key) => {
    data.defaultActiveKey = key;
  };

  return (
    <Tabs activeKey={data.defaultActiveKey} onChange={handleChange}>
      {data.tabList.map((item) => (
        <TabPane tab={item.name} key={item.key}>
          {slots[item.id]?.render()}
        </TabPane>
      ))}
    </Tabs>
  );
}