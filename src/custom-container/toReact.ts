export default function ({ data, slots }) {
  const jsx = `<div style={{height: '100%'}}>
  ${slots['content']?.render()}
</div>`;

  return {
    imports: [],
    jsx,
    style: ``,
    js: ''
  };
}