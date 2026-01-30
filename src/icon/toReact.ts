export default function ({ data, style }) {
  const fontSize = style.width === 'fit-content'
    ? 32
    : style.width !== '100%'
      ? style.width
      : undefined;

  const IconComponent = data.icon;

  const jsx = `<div
    className="icon"
    style={{ 
    fontSize: ${fontSize},
    width: ${fontSize},
    height: ${fontSize},
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    }}
  >
    <${IconComponent} />
  </div>`;

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