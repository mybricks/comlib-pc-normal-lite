import React from 'react';
import { Image } from 'antd';
import { Data } from './constants';

export default function ({ data }: RuntimeParams<Data>) {
  return (
    <Image
      src={data.src}
      width="100%"
      height="100%"
      preview={false}
      style={{
        objectFit: data.objectFit || 'fill',
      }}
    />
  );
}