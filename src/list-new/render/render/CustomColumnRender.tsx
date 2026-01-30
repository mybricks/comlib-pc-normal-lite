import React from 'react';
import { Data } from '../../constants';
import css from '../../style.less';
import classnames from 'classnames';
import { List } from 'antd';

const CustomColumnRender = (
  loading: boolean,
  data: Data,
  dataSource: any,
  gutter,
  slots,
  env
) => {
  const { grid } = data;
  const rowKey = '_itemKey';

  const ListItemRender = ({ [rowKey]: key, index, item }, number) => {
    return (
      <List.Item
        key={key}
        className={env.edit ? '' : 'list-new__item'}
        style={{
          overflowX: env.edit ? 'visible' : 'auto',
          opacity: env.edit && index === 0 ? 0.4 : undefined
        }}
      >
        {slots['item']?.render({
          inputValues: {
            itemData: item,
            index: index
          },
          key: key,
          style: {
            opacity: env.edit && number !== 0 ? 0.4 : undefined,
            filter: env.edit && number !== 0 ? 'blur(0.8px)' : undefined
          }
        })}
      </List.Item>
    );
  };

  return (
    <List
      loading={loading}
      grid={{
        ...grid,
        gutter
      }}
      dataSource={dataSource}
      renderItem={ListItemRender}
      rowKey={rowKey}
      className={classnames(
        css.listWrap,
        env.edit && css.height100,
        dataSource.length === 0 && env.runtime && !loading && css.hideEmpty
      )}
    />
  );
};

export { CustomColumnRender };
