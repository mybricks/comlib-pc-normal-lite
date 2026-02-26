import {Data, SlotIds, OverflowEnum} from './constants';
import {OverflowEditor} from './editors/overflowEditor';
import {PageScrollEditor} from './editors/pageSrcollEditor';
import {AutoScrollEditor} from './editors/autoScrollEditor';
import {StyleEditor} from './editors/styleEditor';
import {EventEditor} from './editors/eventEditor';
import {MaxHeightEditor} from './editors/maxHeightEditor';
import {FixedEditor} from './editors/fixedEditor';
import {getFilterSelector} from '../utils/cssSelector';
import {unitConversion} from '../utils';
import {getNonDefaultStyles} from '../utils/dom';

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
  '@init'({style, data, slot}: EditorResult<Data>) {
    style.height = 'auto';

    if (window._disableSmartLayout) {
      data.slotStyle = {
        alignItems: 'flex-start',
        columnGap: 0,
        display: 'flex',
        flexDirection: 'column',
        flexWrap: 'nowrap',
        justifyContent: 'flex-start',
        position: 'inherit',
        rowGap: 0
      };
    }
  },
  '@resize': {
    options: ['width', 'height']
  },
  '@setLayout'({data,slots,style},val) {
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
    setLayout({data,slots},val);
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
            get(props) {
              const {data, slots, style,element} = props
              const overflow = window.getComputedStyle(element).overflow;
              return { ...(data.slotStyle || {}), overflow: overflow || 'hidden' };
            },
            set({data, slots, style, element}, val: any) {
              if (val.overflow !== undefined) {
                const cleaned = getNonDefaultStyles(element);
                style.setCSS(':root', { ...cleaned, overflow: val.overflow });
              }

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
            // target: ({id}: EditorResult<Data>) => `> .root`
            target: ':root'
          },
          // {
          //   title: 'Hover',
          //   catelog: 'Hover',
          //   options: ['padding', 'border', 'background', 'BoxShadow'],
          //   target: ({id}: EditorResult<Data>) => `> .root:hover`,
          //   domTarget: '.root'
          // }
        ]
      }
    ]
  }
};

function setLayout({data,slots},val) {
  data.slotStyle = val;
  const slotInstance = slots.get('content');
  setSlotLayout(slotInstance, val);
}
