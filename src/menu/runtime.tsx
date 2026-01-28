import React, { useState } from 'react';
import { Menu } from 'antd';
import * as Icons from '@ant-design/icons';
import { Data, MenuItem, MenuTypeEnum } from './constants';

export default function ({ data }: RuntimeParams<Data>) {
  const { dataSource, mode } = data;
  const [selectedKey, setSelectedKey] = useState<string[]>([]);

  const onClick = (e) => {
    setSelectedKey([e.key]);
  };

  const chooseIcon = (icon: string) => {
    const Icon = Icons?.[icon]?.render();
    return Icon || null;
  };

  const renderMenuItems = (ds: MenuItem[]) => {
    return (ds || []).map((item) => {
      const { key, children, menuType, useIcon, icon, title } = item || {};

      if (menuType === MenuTypeEnum.Group) {
        return (
          <Menu.ItemGroup title={title} key={key}>
            {renderMenuItems(children)}
          </Menu.ItemGroup>
        );
      }

      if (menuType === MenuTypeEnum.SubMenu) {
        return (
          <Menu.SubMenu
            title={title}
            key={key}
            icon={useIcon ? chooseIcon(icon) : undefined}
          >
            {renderMenuItems(children)}
          </Menu.SubMenu>
        );
      }

      return (
        <Menu.Item
          key={key}
          icon={useIcon ? chooseIcon(icon) : undefined}
        >
          {title}
        </Menu.Item>
      );
    });
  };

  return (
    <Menu onClick={onClick} mode={mode} selectedKeys={selectedKey}>
      {renderMenuItems(dataSource)}
    </Menu>
  );
}