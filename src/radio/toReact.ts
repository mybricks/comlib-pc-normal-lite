export default function ({ data }) {
  const jsx = `<Radio.Group
  optionType="${data.enableButtonStyle ? 'button' : 'default'}"
  buttonStyle="${data.buttonStyle}"
  disabled={${data.config.disabled}}
  value="${data.value}"
>
  <Space direction="${data.layout === 'vertical' ? 'vertical' : undefined}" wrap={${data.autoBreakLine}}>
    {${data.config.options}?.map((item) => (
      <Radio
        key={item.key}
        value={item.value}
        disabled={item.disabled}
      >
        {item.label}
      </Radio>
    ))}
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
