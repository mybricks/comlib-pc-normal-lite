export default function ({ data, slots }) {
  const jsx = `<Card
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