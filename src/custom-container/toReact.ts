export default function ({ data, slots }) {
  const jsx = `<div className="container">
    ${slots['content']?.render({ style: data.slotStyle })}
  </div>`;

  return {
    imports: [],
    jsx,
    style: ``,
    js: ''
  };
}