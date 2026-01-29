import {Data} from './constants';

const setSlotLayout = (slot, val) => {
  if (!slot) return;
  slot.setStyle(val);
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
  '@init'({style}: EditorResult<Data>) {
    style.height = 'auto';
  },
  '@resize': {
    options: ['width', 'height']
  },
  '@setLayout'({slots,style},val) {
    if (val.position === 'smart') {
      if (style.height === 'auto') {
        style.height = style.heightFact;
        style.heightAuto = undefined;
      }
      if (style.width === 'auto') {
        style.width = style.widthFact;
        style.widthAuto = undefined;
      }
    }
    const slotInstance = slots.get('content');
    setSlotLayout(slotInstance, val);
  },
  ':root': {
    items({slot}: EditorResult<Data>, cate1, cate2, cate3) {
      cate1.title = '常规';
      cate1.items = [
        {
          title: '布局',
          type: 'layout',
          description: '设置布局方式，包括智能布局、纵向排版、横向排版、自由布局',
          options: [],
          value: {
            get({data}: EditorResult<Data>) {
              return data.slotStyle || {};
            },
            set({data, slots}: EditorResult<Data>, val: any) {
              data.slotStyle = val;
              const slotInstance = slots.get('content');
              setSlotLayout(slotInstance, val);
            }
          }
        },
      ];

      return {
        title: '自定义容器'
      };
    },
    style: [
      {
        items: [
          {
            title: '默认',
            catelog: '默认',
            options: ['padding', 'border', 'background', 'overflow', 'BoxShadow'],
            target: ({id}: EditorResult<Data>) => `> div:first-child`
          },
          {
            title: 'Hover',
            catelog: 'Hover',
            options: ['padding', 'border', 'background', 'BoxShadow'],
            target: ({id}: EditorResult<Data>) => `> div:first-child:hover`,
            domTarget: 'div:first-child'
          }
        ]
      }
    ]
  }
};

