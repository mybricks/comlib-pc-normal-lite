import { transformComStyle } from "../utils/toReact";

export default function ({ id, slots, style }) {
  const jsx = `<div className="${id}" ${transformComStyle(style)}>
  ${slots['content']?.render()}
</div>`;

  return {
    imports: [],
    jsx,
    style: ``,
    js: ''
  };
}