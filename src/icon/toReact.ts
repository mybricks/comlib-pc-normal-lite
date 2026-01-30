import { transformComStyle } from "../utils/toReact";

export default function ({ id, data, style }) {
  const fontSize = style.width === 'fit-content'
    ? 32
    : style.width !== '100%'
      ? style.width
      : undefined;

  const IconComponent = data.icon;
  const comStyle = { ...style, fontSize };
  Reflect.deleteProperty(comStyle, "width");
  const jsx = `<${IconComponent} className="${id} icon" ${transformComStyle(comStyle)}/>`

  return {
    imports: [
      {
        from: '@ant-design/icons',
        coms: [data.icon]
      }
    ],
    jsx,
    style: ``,
    js: ''
  };
}