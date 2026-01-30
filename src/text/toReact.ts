import { transformComStyle } from "../utils/toReact";

export default function ({ id, data, style }) {
  const jsx = `<Typography.Text className="${id} text" ${transformComStyle(style)}>
  {${JSON.stringify(data.content || '')}}
</Typography.Text>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Typography']
      }
    ],
    jsx,
    style: ``,
    js: ''
  };
}
