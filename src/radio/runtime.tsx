import React from 'react';
import { Radio, Space } from 'antd';
import { Data } from './types';

export default function Runtime({ env, data }: RuntimeParams<Data>) {
  const options = env.edit ? data.staticOptions : data.config.options;

  if (data.isEditable) {
    return (
      <Radio.Group
        optionType={data.enableButtonStyle ? 'button' : 'default'}
        buttonStyle={data.buttonStyle}
        disabled={data.config.disabled}
        value={data.value}
      >
        <Space direction={data.layout === 'vertical' ? 'vertical' : undefined} wrap={data.autoBreakLine}>
          {options?.map((item) => (
            <Radio
              key={item.key}
              value={item.value}
              disabled={item.disabled}
            >
              {env.i18n(item.label)}
            </Radio>
          ))}
        </Space>
      </Radio.Group>
    );
  }

  return <>{data.value}</>;
}
