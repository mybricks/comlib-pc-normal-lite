import { transformComStyle } from "../utils/toReact";

export default function ({ id, data, slots, style }) {
  const jsx = `<Card
    className="${id}"
    ${transformComStyle(style)}
    title="${data.title}"
    bordered={${data.bordered}}
  >
    ${slots['body']?.render()}
  </Card>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Card']
      }
    ],
    jsx,
    style: '',
    js: ''
  };
}