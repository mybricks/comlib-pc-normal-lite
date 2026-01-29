import React from 'react';
import { Data, SlotIds } from './constants';
import css from './style.less';

export default function (props: RuntimeParams<Data>) {
  const { data, slots } = props;

  return (
    <div className={css.container}>
      {slots[SlotIds.Content]?.render({ style: data.slotStyle })}
    </div>
  );
}