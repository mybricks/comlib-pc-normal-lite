import React, { useEffect, useMemo, useState, createContext } from 'react';
import { Table, Empty, ConfigProvider } from 'antd';
import { InputIds, DefaultRowKey } from './constants';
import { formatColumnItemDataIndex, formatDataSource, getDefaultDataSource } from './utils';
import { Data, IColumn, ContentTypeEnum, WidthTypeEnum, TableLayoutEnum } from './types';
import ColumnRender from './components/ColumnRender';
import ColumnsTitleRender from './components/ColumnsTitleRender';
import ErrorBoundary from './components/ErrorBoundle';
import css from './runtime.less';

export const TableContext = createContext<any>({ slots: {} });

export default function (props: RuntimeParams<Data>) {
  const { env, data, inputs, outputs, slots, style } = props;
  const { runtime, edit } = env;
  const [dataSource, setDataSource] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const rowKey = data.rowKey || DefaultRowKey;

  // 监听 data.dataSource 变化
  useEffect(() => {
    setDataSource(data.dataSource || []);
  }, [data.dataSource]);

  // 运行时设置数据源
  useEffect(() => {
    if (runtime) {
      inputs[InputIds.SET_DATA_SOURCE]?.((ds: any, relOutputs: any) => {
        const hasSetRowKey = !!runtime?.debug && !!data.rowKey && !!data?.hasUpdateRowKey;
        let temp: any[] = [];
        if (Array.isArray(ds)) {
          temp = formatDataSource(ds, rowKey, hasSetRowKey);
        } else if (ds && typeof ds === 'object' && Array.isArray(ds?.dataSource)) {
          temp = formatDataSource(ds?.dataSource, rowKey, hasSetRowKey);
        }
        setDataSource(temp.map((item, index) => ({ ...item, __index: index })));
        setLoading(false);
        relOutputs?.['dataSource']?.(ds);
      });

      // 表格 loading
      inputs[InputIds.START_LOADING]?.((val: any, relOutputs: any) => {
        setLoading(true);
        relOutputs?.['startLoading']?.(val);
      });

      inputs[InputIds.END_LOADING]?.((val: any, relOutputs: any) => {
        setLoading(false);
        relOutputs?.['endLoading']?.(val);
      });
    }
  }, []);

  // 初始化筛选配置
  const filterMap = useMemo(() => {
    const res: Record<string, any> = {};
    data.columns.forEach((cItem) => {
      if (runtime && !cItem.dataIndex && cItem.title) {
        cItem.dataIndex = formatColumnItemDataIndex(cItem);
      }
      const dataIndex = Array.isArray(cItem.dataIndex)
        ? cItem.dataIndex.join('.')
        : cItem.dataIndex;
      res[edit ? cItem.key : dataIndex] = cItem.filter?.options || [];
    });
    return res;
  }, [data.columns]);

  // 设计态数据 mock
  const defaultDataSource = getDefaultDataSource(data.columns, rowKey, env);

  // 渲染列
  const renderColumns = () => {
    return ColumnsTitleRender({
      ...props,
      filterMap,
      dataSource,
      focusRowIndex: null,
      setFocusCellinfo: () => {},
      focusCellinfo: null,
      renderCell: (columnRenderProps) => (
        <ErrorBoundary>
          <ColumnRender {...columnRenderProps} env={env} outputs={outputs} />
        </ErrorBoundary>
      ),
      filterIconDefault: data.filterIconDefault,
      hasConnector: false
    });
  };

  // 获取表格显示列宽度和
  const getUseWidth = () => {
    let hasAuto = false;
    const getWidth = (list: IColumn[]): number => {
      let count = 0;
      list.forEach((item) => {
        if (!item.visible || hasAuto) return;
        if (item.width === WidthTypeEnum.Auto && item.contentType !== ContentTypeEnum.Group) {
          hasAuto = true;
          return;
        }
        if (item.contentType === ContentTypeEnum.Group && item.children?.length) {
          count = count + getWidth(item.children);
        } else {
          count = count + (+(item.width || 0) || 0);
        }
      });
      return count;
    };
    const width = getWidth(data.columns);
    return hasAuto ? '100%' : width;
  };

  const contextValue = useMemo(() => ({ slots }), [slots]);

  // 默认空状态
  const renderEmpty = data.isEmpty
    ? () => <Empty image={data.image || Empty.PRESENTED_IMAGE_SIMPLE} description={env.i18n(data.description)} />
    : undefined;

  return (
    <div className={`${css.tableWarrper} tableWarrper`}>
      <ConfigProvider renderEmpty={renderEmpty}>
        <TableContext.Provider value={contextValue}>
          <div className={`${css.table} table`}>
            {data.columns?.filter(({ visible }) => visible)?.length ? (
              <Table
                className="mybricks-table"
                style={{
                  width: data.tableLayout === TableLayoutEnum.FixedWidth ? getUseWidth() : '100%'
                }}
                dataSource={edit ? defaultDataSource : dataSource}
                loading={{
                  tip: env.i18n(data.loadingTip),
                  spinning: loading
                }}
                rowKey={rowKey}
                size={data.size as any}
                bordered={data.bordered}
                pagination={false}
                showHeader={data.showHeader !== false}
                scroll={{ x: '100%' }}
                tableLayout={
                  (data.tableLayout === TableLayoutEnum.FixedWidth
                    ? TableLayoutEnum.Fixed
                    : data.tableLayout) || TableLayoutEnum.Fixed
                }
              >
                {renderColumns()}
              </Table>
            ) : (
              <Empty description="请添加列或连接数据源" className={css.emptyWrap} />
            )}
          </div>
        </TableContext.Provider>
      </ConfigProvider>
    </div>
  );
}
