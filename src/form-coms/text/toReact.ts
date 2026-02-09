export default function ({ data }) {
  const jsx = `<Input
  {...${JSON.stringify(data.config || {})}}
  value={${JSON.stringify(data.value)}}
/>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Input']
      },
    ],
    jsx,
    style: ``,
    js: ''
  };
}