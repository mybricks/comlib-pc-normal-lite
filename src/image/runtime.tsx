import React, { useCallback, useEffect } from 'react';
import { Image } from 'antd';
import { Data, InputIds, OutputIds } from './constants';
import css from './runtime.less';
import { uuid } from '../utils';

export default function ({ env, data, inputs, outputs, style }: RuntimeParams<Data>) {
  const {
    src
  } = data;
  const { runtime } = env;

  return (
    <div className={css.container}>
      <Image
        src={src}
        width="100%"
        height="100%"
        preview={false}
        style={{
          objectFit: data?.objectFit || 'fill',
        }}
      />
    </div>
  );
}
