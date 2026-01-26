import React, { useEffect } from 'react';

interface Data {
  text: string;
  type?: 'primary' | 'default' | 'dashed' | 'text' | 'link';
  disabled?: boolean;
  style?: React.CSSProperties;
}

export default function ({ data, inputs, outputs, env }: RuntimeParams<Data>) {
  useEffect(() => {
    inputs['setText'] && inputs['setText']((value: string) => {
      data.text = value;
    });

    inputs['setDisabled'] && inputs['setDisabled']((value: boolean) => {
      data.disabled = value;
    });
  }, []);

  const handleClick = () => {
    if (!data.disabled && outputs && outputs['click']) {
      outputs['click']();
    }
  };

  const getButtonStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      padding: '4px 15px',
      fontSize: '14px',
      borderRadius: '2px',
      border: '1px solid #d9d9d9',
      cursor: data.disabled ? 'not-allowed' : 'pointer',
      transition: 'all 0.3s',
      display: 'inline-block',
      textAlign: 'center',
      userSelect: 'none',
      ...data.style
    };

    if (data.disabled) {
      baseStyle.opacity = 0.6;
      baseStyle.backgroundColor = '#f5f5f5';
      baseStyle.color = 'rgba(0, 0, 0, 0.25)';
      baseStyle.borderColor = '#d9d9d9';
    } else {
      switch (data.type) {
        case 'primary':
          baseStyle.backgroundColor = '#1890ff';
          baseStyle.color = '#fff';
          baseStyle.borderColor = '#1890ff';
          break;
        case 'dashed':
          baseStyle.borderStyle = 'dashed';
          baseStyle.backgroundColor = '#fff';
          baseStyle.color = 'rgba(0, 0, 0, 0.85)';
          break;
        case 'text':
          baseStyle.border = 'none';
          baseStyle.backgroundColor = 'transparent';
          baseStyle.color = 'rgba(0, 0, 0, 0.85)';
          break;
        case 'link':
          baseStyle.border = 'none';
          baseStyle.backgroundColor = 'transparent';
          baseStyle.color = '#1890ff';
          break;
        default:
          baseStyle.backgroundColor = '#fff';
          baseStyle.color = 'rgba(0, 0, 0, 0.85)';
      }
    }

    return baseStyle;
  };

  return (
    <button
      style={getButtonStyle()}
      onClick={handleClick}
      disabled={data.disabled}
    >
      {env?.i18n ? env.i18n(data.text || '按钮') : data.text || '按钮'}
    </button>
  );
}
