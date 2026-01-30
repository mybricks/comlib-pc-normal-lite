export default function ({ data }) {
  const options = data.config?.options || [];
  
  // 构建 Space 的属性
  const spaceProps: string[] = [];
  if (data.layout === 'vertical') {
    spaceProps.push('direction="vertical"');
  }
  spaceProps.push(`wrap={${data.autoBreakLine || false}}`);
  
  const jsx = `<Radio.Group
  optionType="${data.enableButtonStyle ? 'button' : 'default'}"
  buttonStyle="${data.buttonStyle}"
  disabled={${data.config?.disabled || false}}
  value="${data.value || ''}"
>
  <Space ${spaceProps.join(' ')}>
    ${options.map((item, index) => `<Radio
      key="${item.key || index}"
      value="${item.value}"
      disabled={${item.disabled || false}}
    >
      ${item.label}
    </Radio>`).join('\n    ')}
  </Space>
</Radio.Group>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Radio', 'Space']
      }
    ],
    jsx,
    style: ``,
    js: ''
  };
}
