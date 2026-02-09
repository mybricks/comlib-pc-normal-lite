export default function ({ data }) {
  const jsx = `<Switch/>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Switch']
      },
    ],
    jsx,
    style: ``,
    js: ''
  };
}
