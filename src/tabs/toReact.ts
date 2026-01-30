import { transformComStyle } from "../utils/toReact";

export default function ({ id, data, slots, style }) {
  const jsx = `<Tabs
    className="${id}"
    ${transformComStyle(style)}
    defaultActiveKey="${data.defaultActiveKey}"
  >
    ${data.tabList.map((item) => `<Tabs.TabPane tab="${item.name}" key="${item.key}">
      ${slots[item.id]?.render()}
    </Tabs.TabPane>`).join('')}
  </Tabs>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Tabs']
      }
    ],
    jsx,
    style: ``,
    js: ''
  };
}