import React, { CSSProperties, useEffect, useMemo, useState } from 'react';
import { Typography } from 'antd';
import css from './runtime.less';

import {
  AlignTypeEnum,
  CursorTypeEnum,
  Data,
  InputIds,
  OutputIds,
  WhiteSpaceEnum
} from './constants';

const { Text, Paragraph } = Typography;

export default ({ data, inputs, outputs, env }: RuntimeParams<Data>) => {

  const onClick = () => {
    if (outputs[OutputIds.Click]) {
      outputs[OutputIds.Click](data.content || '');
    }
  };

  return (
    <div style={{ lineHeight: 1 }}>
        <Text
          className={css.text}
          onClick={onClick}
          data-item-type="root"
        >
          {data.content}
        </Text>
    </div>
  );
};
