import React from 'react';
import { Typography } from 'antd';
import classnames from 'classnames';
import { Data } from './constants';
import css from './runtime.less';

const { Text } = Typography;

export default ({ data }: RuntimeParams<Data>) => {
  return (
    <Text className={classnames(css.text, 'text')}>
      {data.content}
    </Text>
  );
};