export default function ({ data }) {
  // 在渲染过程中同时收集图标，确保收集和使用同步
  const collectedIcons: string[] = [];

  const renderMenuItems = (ds) => {
    return (ds || []).map((item) => {
      const { key, children, menuType, icon, title } = item || {};

      // 只要有 icon 就收集和使用
      let iconAttr = '';
      if (icon && typeof icon === 'string') {
        iconAttr = `icon={<${icon} />}`;
        collectedIcons.push(icon);
      }

      if (menuType === 'group') {
        return `<Menu.ItemGroup title="${title}" key="${key}">
          ${renderMenuItems(children)}
        </Menu.ItemGroup>`;
      }

      if (menuType === 'subMenu') {
        return `<Menu.SubMenu
          title="${title}"
          key="${key}"
          ${iconAttr}
        >
          ${renderMenuItems(children)}
        </Menu.SubMenu>`;
      }

      return `<Menu.Item
        key="${key}"
        ${iconAttr}
      >
        ${title}
      </Menu.Item>`;
    }).join('\n');
  };

  const menuItemsJsx = renderMenuItems(data.dataSource);

  // 去重图标列表
  const iconsList = Array.from(new Set(collectedIcons));

  const jsx = `<Menu mode="${data.mode}">
    ${menuItemsJsx}
  </Menu>`;

  const imports = [
    {
      from: 'antd',
      coms: ['Menu']
    }
  ];

  if (iconsList.length > 0) {
    imports.push({
      from: '@ant-design/icons',
      coms: iconsList
    });
  }

  return {
    imports,
    jsx,
    style: ``,
    js: ''
  };
}