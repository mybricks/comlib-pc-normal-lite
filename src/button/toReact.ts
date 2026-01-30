import { transformComStyle } from "../utils/toReact";

export default function ({ data, style }) {
  const jsx = `<Button
    ${transformComStyle(style)}
    type="${data.type}"
  >
    ${data.text}
  </Button>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Button']
      },
    ],
    jsx,
    style: '',
    js: ''
  };
}
