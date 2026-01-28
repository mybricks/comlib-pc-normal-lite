export default function ({ data }) {
  const jsx = `<Image
    src="${data.src}"
    width="100%"
    height="100%"
    preview={false}
    style={{ objectFit: "${data.objectFit}" || 'fill' }}
  />`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Image']
      }
    ],
    jsx,
    style: ``,
    js: ''
  };
}