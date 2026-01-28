export default function ({ data, slots }) {
  const jsx = `<div className="root">
    ${slots['content']?.render({ style: data.slotStyle })}
  </div>`;

  return {
    imports: [],
    jsx,
    style: ``,
    js: ''
  };
}