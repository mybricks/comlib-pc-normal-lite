import { Data } from './runtime';
import { uuid,isBase64Image } from '../utils';

const regex = /^data:image\/(png|jpeg|jpg|gif|bmp|webp|svg)/;

export default {
  '@init'({ data, style, input, output, slot }) {
    style.height = 200;
  },
  '@resize': {
    options: ['width', 'height']
  },
  ':root'({ data }, cate0) {
    cate0.title = '常规';
    cate0.items = [
      {
        title: '轮播项',
        type: 'array',
        options: {
          selectable: true,
          getTitle: (item, index) => {
            let formattedUrl = isBase64Image(item.url || '')
              ? (item.url || '').match(regex)[0] + '(超长省略) '
              : item.url;
            return [formattedUrl, `轮播图${index + 1}`];
          },
          onSelect: (_id, index) => {
            if (index !== -1) {
              data.slideIndex = index;
            }
          },
          items: [
            {
              title: '图片',
              type: 'imageSelector',
              value: 'url'
            },
            {
              title: '展示',
              type: 'select',
              options: [
                { label: '适应', value: 'contain' },
                { label: '填充', value: 'cover' },
                { label: '铺满', value: '100% 100%' },
                { label: '铺满x轴', value: '100% auto' },
                { label: '铺满y轴', value: 'auto 100%' }
              ],
              value: 'bgSize'
            },
            {
              title: '样式',
              type: 'Style',
              options: {
                plugins: ['bgcolor']
              },
              value: 'bgColor'
            }
          ]
        },
        value: {
          get({ data }: EditorResult<Data>) {
            return data.items;
          },
          set({ data, slot }: EditorResult<Data>, val: any) {
            const newItems = [];
            data.items.map((item) => {
              if (!val.find((v) => v.slotId === item.slotId)) {
                slot.remove(item.slotId);
              }
            });
            val.map((item) => {
              if (!item.slotId) {
                const slotId = uuid();
                item.slotId = slotId;
              }
              if (!slot.get(item.slotId)) {
                slot.add(item.slotId, `轮播图${item.slotId}`);
              }
              newItems.push({ ...(item ?? {}) });
            });
            data.items = newItems.map(item => {
              if (typeof item.bgColor === 'string') {
                return {
                  ...item,
                  bgColor: {
                    background: item.bgColor
                  }
                }
              }
              return item
            });
          }
        }
      },
    ];
  }
};
