import React from 'react';
import { Button } from 'antd';

export default function ({ data }) {

  return (
    <Button
      type={data.type}
      style={{ width: "100%", height: "100%" }}
    >
      {data.text}
    </Button>
  );
}
