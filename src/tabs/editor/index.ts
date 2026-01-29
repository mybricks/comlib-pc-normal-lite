import { Data, InputIds, OutputIds, SlotIds } from '../constants';
import TabEditor from './tab';
import { createItem, addEventIO } from './common';
import {
  createStyleForDefault,
  createStyleForActive,
  createStyleForBar,
  setDynamicTabsIO,
  createFontStyleForActive
} from './utils';
import { getFilterSelector } from '../../utils/cssSelector';
import { setSlotLayout } from '../../utils/editorTools'

export default {
  ':slot': {},
  '@resize': {
    options: ['width', 'height']
  },
  '@init': ({ style }) => {
    style.height = 'auto';
  },
  ':root': {
    items({ }: EditorResult<Data>, cate1, cate2, cate3) {
      cate1.title = '常规';
      cate1.items = [
        {
          title: '插槽布局',
          type: 'layout',
          description: '配置插槽内部的布局类型',
          ifVisible({ data }: EditorResult<Data>) {
            return !data.hideSlots;
          },
          value: {
            get({ data }: EditorResult<Data>) {
              return data.slotStyle || {};
            },
            set({ data, slots }: EditorResult<Data>, val: any) {
              data.slotStyle = val;
              data.tabList.forEach((item) => {
                const slotInstance = slots.get(item.id);
                setSlotLayout(slotInstance, val);
              });
            }
          }
        },
        {
          title: '添加标签页',
          type: 'Button',
          description: '新增一个标签页，增加一个标签页插槽、标签页显示和隐藏输出',
          value: {
            set({ data, slots, output, env }: EditorResult<Data>) {
              const newItem = createItem(data);
              slots.add({
                id: newItem.id,
                title: newItem.name
              });
              const slotInstance = slots.get(newItem.id);
              setSlotLayout(slotInstance, data.slotStyle);
              addEventIO(output, newItem, env);
              data.tabList.push(newItem);
            }
          }
        },
        {
          title: '标签位置',
          type: 'Select',
          description: '标签位置, 默认是上部(top)',
          options: [
            { label: '上', value: 'top' },
            { label: '左', value: 'left' },
            { label: '右', value: 'right' },
            { label: '下', value: 'bottom' }
          ],
          value: {
            get({ data }: EditorResult<Data>) {
              return data.tabPosition || 'top';
            },
            set({ data }: EditorResult<Data>, value: 'left' | 'top' | 'bottom' | 'right') {
              data.tabPosition = value;
            }
          }
        },
        {
          title: '标签居中',
          type: 'Switch',
          description: '标签页是否居中',
          value: {
            get({ data }: EditorResult<Data>) {
              return data.centered;
            },
            set({ data }: EditorResult<Data>, value: boolean) {
              data.centered = value;
            }
          }
        },

      ];
    },
    style: [
      {
        title: '标签头',
        description: 'tab整个标签头，可以配置背景色和内边距',
        options: ['padding', { type: 'background', config: { disableBackgroundImage: true } }],
        target: '.ant-tabs .ant-tabs-nav-wrap'
      },
      {
        items: [
          {
            catelog: '默认',
            ...createStyleForDefault({
              initValue: {
                color: 'rgba(0,0,0,.85)'
              },
              target: ({ id }: EditorResult<Data>) =>
                `.ant-tabs .ant-tabs-nav-wrap .ant-tabs-tab:not(.ant-tabs-tab-active)${getFilterSelector(id)}, .ant-tabs-nav-operations${getFilterSelector(id)}, .ant-tabs-nav-more${getFilterSelector(id)}`
            })
          },
          {
            catelog: '默认',
            title: '外边距',
            options: ['margin'],
            target: '.ant-tabs:not(.ant-tabs-card) .ant-tabs-nav-wrap .ant-tabs-tab+.ant-tabs-tab'
          },
          {
            catelog: '默认',
            title: '底部横线',
            options: ['border'],
            target: '.ant-tabs-top>.ant-tabs-nav:before'
          },
          {
            catelog: 'Hover',
            title: '标签',
            options: [
              { type: 'font', config: { disableTextAlign: true } },
              { type: 'background', config: { disableBackgroundImage: true } }
            ],
            target: '.ant-tabs-tab:hover'
          },
          {
            catelog: '激活',
            ...createStyleForActive({
              title: '标签',
              initValue: {
                color: '#1890ff'
              },
              target: ({ id }: EditorResult<Data>) => 
                `.ant-tabs .ant-tabs-nav-wrap .ant-tabs-tab-active${getFilterSelector(id)}`
            })
          },
          {
            catelog: '激活',
            ...createFontStyleForActive({
              initValue: {
                color: '#1890ff'
              },
              title: '标签文本',
              target: ({ id }: EditorResult<Data>) =>
                `.ant-tabs .ant-tabs-nav-wrap .ant-tabs-tab-active${getFilterSelector(
                  id
                )} div.ant-tabs-tab-btn span`
            })
          },
          {
            catelog: '激活',
            ...createStyleForBar()
          }
        ]
      },
    ]
  },
  ...TabEditor
};
