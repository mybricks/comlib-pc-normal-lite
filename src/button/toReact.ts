export default function ({ data }) {  
  const jsx = `<Button
    style={${JSON.stringify({ width: "100%", height: "100%" })}}
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
