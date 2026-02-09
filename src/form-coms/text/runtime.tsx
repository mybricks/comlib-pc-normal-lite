import { Form, Input, InputRef, Image } from 'antd';
import React  from 'react';
import css from './runtime.less';

export default function (props) {
  const { data } = props;
  return (
    <Input
      className={css.input}
      {...data.config}
      value={data.value}
    />
  )
}
