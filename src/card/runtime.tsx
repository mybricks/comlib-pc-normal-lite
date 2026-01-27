import React, { useEffect, useCallback } from 'react';
import { Card } from 'antd';
import { Data, InputIds, OutputIds, SlotIds } from './constants';
import css from './runtime.less';

export default (props: RuntimeParams<Data>) => {
  const { data, slots, env } = props;
  const {
    title,
    bordered,
    isHeight,
    height
  } = data;

  return (
    <div className={`${css.card} card`}>
      <Card
        title={data.showTitle ? env.i18n(title) : ''}
        bodyStyle={{
          padding: data.padding,
          height: isHeight ? height : '100%'
        }}
        bordered={bordered}
        style={{
          height: isHeight ? void 0 : props.style.height,
          overflow: isHeight ? void 0 : 'auto'
        }}
      >
        <div
          style={{
            overflowY: data.isHeight && env.runtime ? 'auto' : 'hidden',
            overflowX: typeof props.style.width === 'number' ? 'auto' : void 0
          }}
          className={css.containerCard}
        >
          {slots[SlotIds.Body]?.render({
            style: env.runtime ? data.slotStyle : { ...data.slotStyle, minHeight: 30 }
          })}
        </div>
      </Card>
    </div>
  );
};
