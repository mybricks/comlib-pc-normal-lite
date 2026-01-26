import React, { useEffect, useState } from 'react';

interface Data {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export default function ({ data, inputs, outputs, env }: RuntimeParams<Data>) {
  const [value, setValue] = useState(data.value || '');

  useEffect(() => {
    inputs['setValue']?.((val: string) => {
      const newValue = val !== undefined && val !== null ? String(val) : '';
      data.value = newValue;
      setValue(newValue);
    });

    inputs['setPlaceholder']?.((val: string) => {
      data.placeholder = val;
    });

    inputs['setDisabled']?.((val: boolean) => {
      data.disabled = val;
    });
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    data.value = newValue;
    setValue(newValue);
    
    if (outputs && outputs['onChange']) {
      outputs['onChange'](newValue);
    }
  };

  const handleBlur = () => {
    if (outputs && outputs['onBlur']) {
      outputs['onBlur'](value);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 11px',
    fontSize: '14px',
    lineHeight: '1.5715',
    color: 'rgba(0, 0, 0, 0.85)',
    backgroundColor: data.disabled ? '#f5f5f5' : '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '2px',
    transition: 'all 0.3s',
    outline: 'none',
    cursor: data.disabled ? 'not-allowed' : 'text',
    ...data.style
  };

  return (
    <input
      type="text"
      value={value}
      placeholder={env?.i18n ? env.i18n(data.placeholder || '') : data.placeholder || ''}
      disabled={data.disabled}
      onChange={handleChange}
      onBlur={handleBlur}
      style={inputStyle}
    />
  );
}
