import { transformComStyle } from "../utils/toReact";

export default function ({ id, data, style }) {
  const jsx = `<Image
    className="${id}"
    ${transformComStyle({ ...style, objectFit: data.objectFit })}
    src="${data.src}"
    preview={false}
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