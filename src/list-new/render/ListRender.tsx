import { VerticalWarpRender } from './render/VerticalWarpRender';
import { NoAutoWarpRender } from './render/NoAutoWarpRender';
import { CustomColumnRender } from './render/CustomColumnRender';
import { ResponsiveRender } from './render/ResponsiveRender';
import { Data, Layout } from '../constants';

const ListRender = (
  env,
  slots,
  data: Data,
  dataSource: any,
  loading: boolean,
  gutter,
  columns
) => {
  // 响应式布局
  if (data.layout === Layout.Grid && data.isResponsive) {
    return ResponsiveRender(loading, data, dataSource, gutter, slots, env, columns);
  }
  // 垂直布局
  if (data.layout === Layout.Vertical) {
    return VerticalWarpRender(loading, data, dataSource, slots, env);
  }
  // 栅格布局
  if (data.layout === Layout.Grid) {
    return CustomColumnRender(loading, data, dataSource, gutter, slots, env);
  }
  // 横向布局
  if (data.layout === Layout.Horizontal) {
    return NoAutoWarpRender(loading, data, dataSource, slots, env);
  }
};

export { ListRender };
