export default function ({ data, slots }) {
  const jsx = `<Tabs
    activeKey="${data.defaultActiveKey}"
    onChange={(key) => { data.defaultActiveKey = key; }}
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