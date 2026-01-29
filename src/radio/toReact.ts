export default function ({ data }) {
  const options = data.config?.options || [];
  
  const jsx = `<Radio.Group
  optionType="${data.enableButtonStyle ? 'button' : 'default'}"
  buttonStyle="${data.buttonStyle}"
  disabled={${data.config?.disabled || false}}
  value="${data.value || ''}"
>
  <Space direction="${data.layout === 'vertical' ? 'vertical' : undefined}" wrap={${data.autoBreakLine || false}}>
    ${options.map((item) => `<Radio
      key="${item.key}"
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
