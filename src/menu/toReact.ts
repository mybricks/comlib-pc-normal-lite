export default function ({ data }) {
  const collectIcons = (items) => {
    const icons = [];
    (items || []).forEach(item => {
      if (item.useIcon && item.icon) {
        icons.push(item.icon);
      }
      if (item.children) {
        icons.push(...collectIcons(item.children));
      }
    });
    return [...new Set(icons)];
  };

  const iconsList = collectIcons(data.dataSource);

  const renderMenuItems = (ds) => {
    return (ds || []).map((item) => {
      const { key, children, menuType, useIcon, icon, title } = item || {};

      if (menuType === 'group') {
        return `<Menu.ItemGroup title="${title}" key="${key}">
          ${renderMenuItems(children)}
        </Menu.ItemGroup>`;
      }

      if (menuType === 'subMenu') {
        return `<Menu.SubMenu
          title="${title}"
          key="${key}"
          ${useIcon && icon ? `icon={<${icon} />}` : ''}
        >
          ${renderMenuItems(children)}
        </Menu.SubMenu>`;
      }

      return `<Menu.Item
        key="${key}"
        ${useIcon && icon ? `icon={<${icon} />}` : ''}
      >
        ${title}
      </Menu.Item>`;
    }).join('\n');
  };

  const menuItemsJsx = renderMenuItems(data.dataSource);

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