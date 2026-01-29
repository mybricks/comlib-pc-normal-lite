export default function ({ data }) {
  const jsx = `<Typography.Text className="text">
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
