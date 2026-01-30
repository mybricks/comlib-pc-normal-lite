import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Data, InputIds, Layout } from './constants';
import { ListRender } from './render/ListRender';
import { sortUsePoint, columnHandel } from './utils';
import { uuid } from '../utils';
import classnames from 'classnames';
import css from './style.less';

const mockData = new Array(20).fill('').map((_, index) => `id${index + 1}`);
const rowKey = '_itemKey';

export default ({ data, inputs, slots, env, style }: RuntimeParams<Data>) => {
  const { grid } = data;
  const gutter: any = Array.isArray(grid.gutter) ? grid.gutter : [grid.gutter, 16];
  const [dataSource, setDataSource] = useState<any[]>([...(data.dataSource || [])]);
  const datasourceRef = useRef([...(data.dataSource || [])]);

  // 监听数据源变化
  useEffect(() => {
    if (data.dataSource) {
      const ds = data.dataSource.map((item, index) => ({
        item,
        [rowKey]: data.rowKey === '' ? uuid() : item[data.rowKey] || uuid(),
        index: index
      }));
      setDataSource(ds);
      datasourceRef.current = ds;
    } else {
      setDataSource([]);
      datasourceRef.current = [];
    }
  }, [data.dataSource]);

  // 运行时设置数据源
  useEffect(() => {
    if (env.runtime) {
      inputs[InputIds.DATA_SOURCE]((v, relOutputs) => {
        if (Array.isArray(v)) {
          const ds = v.map((item, index) => ({
            item,
            [rowKey]: data.rowKey === '' ? uuid() : item[data.rowKey] || uuid(),
            index: index
          }));
          data.dataSource = ds;
          setDataSource(ds);
          datasourceRef.current = ds;
          relOutputs['setDataSourceDone'](ds);
        }
      });
    }
  }, []);

  // 计算响应式列数
  const columns = useMemo(() => {
    const orderedOptions = (data.customOptions || []).sort(sortUsePoint);
    const width = window.innerWidth;
    return columnHandel(orderedOptions, width) || 1;
  }, [data.customOptions]);

  // 计算 overflow 样式
  const overflow = useMemo(() => {
    let overflowX: string | undefined = undefined;
    let overflowY: string | undefined = undefined;
    if (style.width === 'fit-content' && style.height !== 'fit-content') {
      overflowX = 'hidden';
      overflowY = 'auto';
    }
    if (style.width !== 'fit-content' && style.height === 'fit-content') {
      overflowX = 'auto';
      overflowY = 'hidden';
    }
    if (style.width !== 'fit-content' && style.height !== 'fit-content') {
      overflowX = 'auto';
      overflowY = 'auto';
    }
    if (data.layout === Layout.Horizontal && !data.isAuto) {
      overflowX = 'auto';
      overflowY = style.height === 'fit-content' ? 'hidden' : 'auto';
    }
    return [overflowX, overflowY];
  }, [style.height, style.width, data.layout, data.isAuto]);

  // 横向均匀分布的样式
  const uniformStyle =
    data.layout === 'horizontal' && !data.isAuto && data.horizonLayout === 'UniformLayout'
      ? { display: 'flex', justifyContent: 'space-between' }
      : {};

  // 编辑态使用 mock 数据
  const displayDataSource = env.edit
    ? data.layout === Layout.Vertical
      ? mockData.slice(0, data.mockCount || 2)
      : data.layout === Layout.Horizontal
        ? mockData.slice(0, data.mockCount || 3)
        : mockData.slice(0, data.mockCount || 4)
    : dataSource;

  return (
    <div
      className={classnames(
        css.container,
        env.edit && css.editContainer,
        data.layout === Layout.Horizontal && !data.isAuto && css.scrollContainer,
        'list-new__root'
      )}
      style={{
        overflow: `${overflow[0]} ${overflow[1]}`,
        ...uniformStyle
      }}
    >
      {ListRender(
        env,
        slots,
        data,
        displayDataSource,
        false,
        gutter,
        columns
      )}
    </div>
  );
};
