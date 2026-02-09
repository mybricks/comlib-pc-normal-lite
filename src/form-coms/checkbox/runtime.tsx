import React, { useMemo, useState } from 'react';
import css from './runtime.less';
import { Checkbox, Space } from 'antd';

export default function Runtime({
  env,
  data,
}) {
  // 从选项中获取初始选中值
  const initialValue = useMemo(() => {
    return (data.config.options || [])
      .filter(opt => opt.checked)
      .map(opt => opt.value);
  }, []);

  const [value, setValue] = useState<string[]>(initialValue);

  // 选项列表
  const options = useMemo(() => {
    return data.config.options || data.staticOptions || [];
  }, [data.config.options, data.staticOptions]);

  // 值变化处理
  const onChange = (checkedValues: string[]) => {
    setValue(checkedValues);
  };

  // 渲染选项
  const renderOptions = useMemo(() => {
    return options.map((option) => (
      <Checkbox
        key={option.key || option.value}
        value={option.value}
        disabled={option.disabled}
      >
        {option.label}
      </Checkbox>
    ));
  }, [options]);

  return (
    <div className={`${css.checkbox} checkbox`}>
      <Checkbox.Group
        disabled={data.config.disabled}
        value={value}
        onChange={onChange}
      >
        <Space direction="horizontal">
          {renderOptions}
        </Space>
      </Checkbox.Group>
    </div>
  );
}
