import { Data, OutputIds, SizeOptions, SlotIds, Item } from './constants';
import { Editor, EditorType } from '../utils/editor';
import { getFilterSelector } from '../utils/cssSelector';

export const setSlotLayout = (slot, val) => {
  if (!slot) return;
  if (val.position === 'smart') {
    slot.setLayout('smart');
  } else if (val.position === 'absolute') {
    slot.setLayout(val.position);
  } else if (val.display === 'flex') {
    if (val.flexDirection === 'row') {
      slot.setLayout('flex-row');
    } else if (val.flexDirection === 'column') {
      slot.setLayout('flex-column');
    }
  }
};

export default {
  ':slot': {},
  '@init'({ style, data }: EditorResult<Data>) {
    style.height = 'auto';
  },
  '@resize': {
    options: ['width', 'height']
  },
  ':root': {
    style: [
      {
        title: '标题',
        options: ['font'],
        target: ({ id }: EditorResult<Data>) => `.card .ant-card-head-title${getFilterSelector(id)}`
      },
      {
        title: '边框',
        options: ['border'],
        target: ({ id }: EditorResult<Data>) => `.card > .ant-card${getFilterSelector(id)}`
      },
      {
        title: '背景',
        options: ['background'],
        target: ({ id }: EditorResult<Data>) => `.card > .ant-card${getFilterSelector(id)}`
      },
      Editor<Data>('鼠标移过时可浮起', EditorType.Switch, 'hoverable'),
      Editor<Data>('尺寸', EditorType.Select, 'size', {
        options: SizeOptions
      }),
    ],
    items: ({}: EditorResult<Data>, cate1, cate2) => {
      cate1.title = '常规';
      cate1.items = [
        {
          title: '布局',
          type: 'layout',
          options: [],
          description: '配置卡片的内部的布局类型',
          value: {
            get({ data, slots }: EditorResult<Data>) {
              const { slotStyle = {} } = data;
              const slotInstance = slots.get(SlotIds.Body);
              setSlotLayout(slotInstance, slotStyle);
              return slotStyle;
            },
            set({ data, slots }: EditorResult<Data>, val: any) {
              if (!data.slotStyle) {
                data.slotStyle = {};
              }
              data.slotStyle = {
                ...data.slotStyle,
                ...val
              };
              const slotInstance = slots.get(SlotIds.Body);
              setSlotLayout(slotInstance, val);
            }
          }
        },
        {
          title: '标题内容',
          type: 'Text',
          description: '卡片的标题内容',
          value: {
            get({ data }: EditorResult<Data>) {
              return data.title;
            },
            set({ data }: EditorResult<Data>, value: string) {
              data.title = value;
            }
          },
          binding: {
            with: 'data.title',
            schema: {
              type: 'string'
            }
          }
        }
      ];
    }
  },
  '.ant-card-head .ant-card-head-wrapper .ant-card-head-title': {
    '@dblclick': {
      type: 'text',
      value: {
        get({ data }: EditorResult<Data>) {
          return data.title;
        },
        set({ data }: EditorResult<Data>, value: string) {
          data.title = value;
        }
      }
    }
  }
};
