import { transformComStyle } from "../utils/toReact";

export default function ({ id, data, style }) {
  const options = data.config?.options || [];
  
  // 构建 Space 的属性
  const spaceProps: string[] = [];
  if (data.layout === 'vertical') {
    spaceProps.push('direction="vertical"');
  }
  if (data.autoBreakLine) {
    spaceProps.push(`wrap={true}`);
  }
  
  const jsx = `<Radio.Group
  className="${id}"
  ${transformComStyle(style)}
  ${data.enableButtonStyle ? `optionType="button"` : ""}
  buttonStyle="${data.buttonStyle}"
  ${data.config?.disabled ? `disabled={true}`: ""}
>
  <Space ${spaceProps.join(' ')}>
    ${options.map((item, index) => `<Radio
      value="${item.value}"
      ${item.disabled ? `disabled={true}`: ""}
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
