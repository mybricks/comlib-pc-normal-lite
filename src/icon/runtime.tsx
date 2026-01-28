import React from 'react';
import * as Icons from '@ant-design/icons';
import { Data } from './constants';
import css from './runtime.less';

export default function ({ data, style }: RuntimeParams<Data>) {
  const fontSize = style.width === 'fit-content'
    ? 32
    : style.width !== '100%'
      ? style.width
      : undefined;

  const Icon = Icons?.[data.icon as string]?.render();

  return (
    <div
      className={`${css.icon} icon`}
      style={{ fontSize }}
    >
      {Icon}
    </div>
  );
}