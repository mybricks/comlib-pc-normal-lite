import React, { useCallback, useEffect, useState, ReactNode, useMemo } from 'react';
import classnames from 'classnames';
import { Tabs, Tooltip, Badge } from 'antd';
import { Data, InputIds, OutputIds, SlotIds, TabItem } from './constants';
import css from './runtime.less';
import { usePrevious } from '../utils/hooks';
import { getWhatToDoWithoutPermission } from '../utils/permission';
import cx from 'classnames';

const { TabPane } = Tabs;


export default function ({
  env,
  data,
  slots,
  inputs,
  outputs,
  onError,
  logger
}: RuntimeParams<Data>) {
  const [showTabs, setShowTabs] = useState<string[]>(
    () => data.tabList?.map((item) => item.id) || []
  );

  useEffect(() => {
    setShowTabs(() => (data.tabList ?? []).map((item) => item.id));
  }, [data.tabList]);

  function isHasPermission(permission?: ConfigPermission) {
    return !permission || getWhatToDoWithoutPermission(permission, env).type === 'none';
  }

  const preKey = usePrevious<string | undefined>(data.defaultActiveKey);
  const findTargetByKey = useCallback(
    (target = data.defaultActiveKey) => {
      return data.tabList.find(
        ({ id, permission, key }) =>
          isHasPermission(permission) && showTabs?.includes(id as string) && key === target
      );
    },
    [showTabs, data.defaultActiveKey]
  );

  useEffect(() => {
    if (env.runtime) {
      if (data.tabList.length && !data.active) {
        data.defaultActiveKey = data.tabList[0].key;
      }

    }
  }, [showTabs]);

  useEffect(() => {
    if (env.runtime) {
      // tabRenderHook();
      tabLeaveHook().then(tabIntoHook);
    }
  }, [data.defaultActiveKey]);

  const tabIntoHook = () => {
    const currentTab = findTargetByKey();
    if (currentTab) {
      // currentTab.render = true; //标记render状态
      outputs[`${currentTab.id}_into`]();
    }
  };

  const tabLeaveHook = () => {
    if (preKey === undefined) return Promise.resolve();
    const preTab = findTargetByKey(preKey);
    if (preTab) return Promise.all([outputs[`${preTab.id}_leave`]()]);
    return Promise.resolve();
  };

  const onEdit = (targetKey, action) => {
    const actionMap = {
      add() {
        outputs[OutputIds.AddTab](data.tabList);
      },
      remove(key: string) {
        let index = data.tabList.findIndex((i) => i.key == key);
        if (index == -1) return;
        // 直接删除
        let item = data.tabList.splice(index, 1);
        // 如果删除为当前激活tab，则激活下一个tab
        if (data.defaultActiveKey === key && data.tabList.length) {
          let activeIndex = Math.min(index, data.tabList.length - 1);
          data.defaultActiveKey = data.tabList[activeIndex].key + '';
        }
        outputs[OutputIds.RemoveTab](item[0]);

      }
    };
    actionMap[action](targetKey);
  };

  const renderItems = () => {
    return (
      <>
        {data.tabList.map((item) => {
          if (env.runtime && (!isHasPermission(item.permission) || !showTabs?.includes(item.id))) {
            return null;
          }

          return (
            <TabPane
              tab={item.name}
              key={item.key}
              closable={!!item.closable}
              forceRender={!!data.forceRender}
            >
              {data.hideSlots ? null : (
                <div className={classnames(css.content, env.edit && css.minHeight)}>
                  {slots[item.id]?.render({
                    key: item.id,
                    style: data.slotStyle
                  })}
                </div>
              )}
            </TabPane>
          );
        })}
      </>
    );
  };

  const findIndexByKey = useCallback(
    (target = data.defaultActiveKey) => {
      return data.tabList.findIndex(
        ({ id, permission, key }) =>
          isHasPermission(permission) && showTabs?.includes(id as string) && key === target
      );
    },
    [showTabs, data.defaultActiveKey]
  );

  const handleClickItem = useCallback(
    (values) => {
      if (!data.prohibitClick) {
        data.defaultActiveKey = values;
      }
      if (env.runtime && outputs && outputs[OutputIds.OnTabClick]) {
        const item = findTargetByKey(values) || {};
        const index = findIndexByKey(values);
        outputs[OutputIds.OnTabClick]({ ...item, index });
      }
    },
    [showTabs]
  );

  return (
    <div
      className={cx([
        css.tabbox,
        'root',
      ])}
    >
      <Tabs
        activeKey={data.defaultActiveKey}
        size={'middle'}
        hideAdd={true}
        onChange={handleClickItem}
        onEdit={env.edit ? undefined : onEdit}
      >
        {renderItems()}
      </Tabs>
    </div>
  );
}
