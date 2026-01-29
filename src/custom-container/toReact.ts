export default function ({ data, slots }) {
  const jsx = `<div>
    ${slots['content']?.render()}
  </div>`;

  return {
    imports: [],
    jsx,
    style: ``,
    js: ''
  };
}