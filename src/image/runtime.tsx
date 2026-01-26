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

  const uuidId = uuid(); // 使用runtime.less生成的选择器对每个组件是固定的，所以需要再加id处理


  const onClick = useCallback(() => {
    outputs[OutputIds.Click]();
  }, []);

  return (
    <div className={css.container}>
      <Image
        src={src}
        width="100%"
        height="100%"
        style={{
          objectFit: data?.objectFit || 'fill',
          cursor:
            outputs[OutputIds.Click] && outputs[OutputIds.Click]?.getConnections()?.length > 0
              ? 'pointer'
              : undefined
        }}
        onClick={onClick}
      />
    </div>
  );
}
