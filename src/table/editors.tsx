import React from 'react';
import { message } from 'antd';
import { Data, IColumn, ContentTypeEnum, WidthTypeEnum } from './types';
import { COLUMN_EDITORS_CLASS_KEY, ColorMap } from './constants';
import { setDataSchema } from './schema';

// 生成唯一ID
const uuid = () => Math.random().toString(36).substring(2, 15);

// 创建新列
const getNewColumn = (data: Data): IColumn => ({
  title: `列${data.columns.length + 1}`,
  dataIndex: `col${data.columns.length + 1}`,
  key: uuid(),
  width: 140,
  visible: true,
  contentType: ContentTypeEnum.Text,
  keepDataIndex: true
});

// 设置列并格式化
const setColumns = ({ data, slot }: { data: Data; slot: any }, newColumns: IColumn[]) => {
  data.columns.forEach((column) => {
    if (!newColumns?.find?.((temp) => temp.key === column.key)) {
      if (column.slotId && slot?.get(column.slotId)) {
        slot.remove(column.slotId);
      }
    }
  });
  data.columns = newColumns.map((item) => {
    let dataIndex =
      typeof item.dataIndex === 'string' ? item.dataIndex.trim().split('.') : item.dataIndex;
    if (Array.isArray(dataIndex) && dataIndex.length === 1) {
      dataIndex = dataIndex[0];
    }
    return {
      title: item.title,
      key: uuid(),
      width: 140,
      visible: true,
      contentType: ContentTypeEnum.Text,
      ...item,
      dataIndex
    };
  });
};

// 显示/隐藏选项渲染
const visibleOpt = ({ item, index, setList, list }) => {
  return (
    <div
      style={{ cursor: 'pointer', padding: '0 4px' }}
      onClick={() => {
        const newList = [...list];
        newList[index] = { ...item, visible: !item.visible };
        setList(newList);
      }}
    >
      {item.visible ? '隐藏' : '显示'}
    </div>
  );
};

// 内联函数
const findColumnItemByKey = (columns: IColumn[], key: string): IColumn | undefined => {
  for (const column of columns) {
    if (column.key === key) return column;
    if (column.children) {
      const found = findColumnItemByKey(column.children, key);
      if (found) return found;
    }
  }
  return undefined;
};

const getColumnItem = (data: Data, focusArea: any): IColumn | undefined => {
  const key = focusArea?.dataset?.tableThIdx;
  return key ? findColumnItemByKey(data.columns, key) : undefined;
};

const setCol = (
  { data, focusArea }: { data: Data; focusArea: any },
  propName: keyof IColumn,
  value: any
) => {
  const item = getColumnItem(data, focusArea);
  if (item) {
    (item as any)[propName] = value;
    data.columns = [...data.columns];
  }
};

const getFilterSelector = (id: string) => `:not(#{id} *[data-isslot="1"] *)`;

export default {
  ':slot': {},
  '@init': ({ style }) => {
    style.height = 'auto';
  },
  '@resize': {
    options: ['width', 'height']
  },
  ':root': {
    items: ({ data, env, output, input, slot, ...res }: EditorResult<Data>, ...cateAry) => {
      cateAry[0].title = '常规';
      cateAry[0].items = [
        {
          title: '',
          type: 'array',
          description: '手动添加表格列',
          options: {
            addText: '添加列',
            editable: true,
            customOptRender: visibleOpt,
            handleDelete: (item: IColumn) => item?.isRowKey,
            tagsRender: (item: IColumn) => (item?.isRowKey ? [{ text: 'Key' }] : []),
            getTitle: (item: IColumn) => {
              const path = Array.isArray(item.dataIndex) ? item.dataIndex.join('.') : item.dataIndex;
              const { color, text } = ColorMap[item.dataSchema?.type] || ColorMap.string;
              if (item.visible) {
                return (
                  <>
                    <span style={{ color }}>{text}</span>
                    <span>
                      【{item.width === WidthTypeEnum.Auto ? '自适应' : `${item.width}px`}】
                      {env.i18n(item.title)}
                      {path ? `(${path})` : ''}
                    </span>
                  </>
                );
              } else {
                return (
                  <>
                    <span style={{ color }}>{text}</span>
                    <span>
                      【隐藏】{env.i18n(item.title)}({path})
                    </span>
                  </>
                );
              }
            },
            onAdd: () => {
              return getNewColumn(data);
            },
            items: [
              {
                title: '列名',
                type: 'TextArea',
                options: {
                  locale: true,
                  autoSize: { minRows: 2, maxRows: 2 }
                },
                value: 'title'
              },
              {
                title: '字段',
                type: 'Text',
                value: 'dataIndex',
                options: {
                  placeholder: '不填默认使用 列名 作为字段'
                }
              },
              {
                title: '设置为唯一key',
                type: 'switch',
                value: 'isRowKey',
                description:
                  '当表格数据太大导致卡顿时，可以通过添加【行标识字段】进行性能优化。该标识字段的值需要全局唯一。此外也可以当作设置勾选数据时的标识',
                ifVisible() {
                  return typeof data?.hasUpdateRowKey !== 'undefined';
                }
              },
              {
                title: '适应剩余宽度',
                type: 'switch',
                value: 'isAutoWidth',
                ifVisible(item: IColumn) {
                  return item.contentType !== ContentTypeEnum.Group;
                },
                options: {
                  type: 'number'
                }
              },
              {
                title: '宽度',
                type: 'Text',
                value: 'width',
                ifVisible(item: IColumn) {
                  return (
                    item.contentType !== ContentTypeEnum.Group && item.width !== WidthTypeEnum.Auto
                  );
                },
                options: {
                  type: 'number'
                }
              }
            ]
          },
          value: {
            get({ data }: EditorResult<Data>) {
              return [
                ...data.columns.map((item) => ({
                  ...item,
                  isAutoWidth: item.width === WidthTypeEnum.Auto
                }))
              ];
            },
            set({ data, output, input, slot, ...res }: EditorResult<Data>, val: IColumn[]) {
              let newRowKey = data?.rowKey;
              for (let item of val) {
                if (item.dataIndex === '') {
                  item.dataIndex = item.title;
                  message.warning(`表格列字段不能为空！`);
                }

                if (item?.isRowKey && data.rowKey !== item.dataIndex) {
                  newRowKey = String(item.dataIndex);
                } else if (data.rowKey === item.dataIndex && !item?.isRowKey) {
                  (item as any)._renderKey = uuid();
                  message.warning(`必须设置一个唯一key`);
                }
              }

              data.rowKey = newRowKey;

              const cols = val.map((item) => ({
                ...item,
                width: item.isAutoWidth ? WidthTypeEnum.Auto : Number(item.width) || 140,
                isAutoWidth: undefined,
                isRowKey: data?.rowKey && item?.dataIndex === data?.rowKey
              }));
              setColumns({ data, slot }, cols as IColumn[]);
              setDataSchema({ data, output, input, slot, ...res });
            }
          }
        }
      ];

      cateAry[1].title = '样式';
      cateAry[1].items = [
        {
          title: '表头',
          type: 'styleNew',
          options: [
            'font',
            'border',
            'padding',
            { type: 'background', config: { disableBackgroundImage: true } }
          ],
          target: ({ id }) => `table thead tr th${getFilterSelector(id)}`
        },
      ]
    }
  },
  [COLUMN_EDITORS_CLASS_KEY]: {
    title: '表格列',
    '@dblclick': {
      type: 'text',
      value: {
        get({ data, focusArea }: EditorResult<Data>) {
          const item = getColumnItem(data, focusArea);
          return item?.title;
        },
        set({ data, focusArea }: EditorResult<Data>, val) {
          setCol({ data, focusArea }, 'title', val);
        }
      }
    }
  }
};
