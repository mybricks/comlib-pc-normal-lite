import { Data, AlignTypeEnum, OutputIds, Schemas, InputIds } from './constants';

export default {
  '@init'({ style }) {
    style.width = 'fit-content';
  },
  '@resize': {
    options: ['width']
  },
  ':root': {
    '@dblclick': {
      type: 'text',
      value: {
        get({ data }: EditorResult<Data>) {
          return data.content;
        },
        set({ data }: EditorResult<Data>, value: string) {
          data.content = value;
        }
      }
    },
    style: [
      {
        items: [
          {
            title: '默认',
            catelog: '默认',
            options: [
              'font',
              'border',
              'padding',
              { type: 'background', config: { disableBackgroundImage: true } }
            ],
            target: '[data-item-type="root"]'
          },
        ]
      }
    ],
    items: ({}: EditorResult<Data>, cate1) => {
      cate1.title = '常规';
      cate1.items = [
        {
          title: '内容',
          type: 'textarea',
          description:
            '设置文本的默认内容，也可以通过逻辑连线连接文本的输入项【内容】动态修改文本的内容',
          options: {
            locale: true
          },
          value: {
            get({ data }: EditorResult<Data>) {
              return data.content;
            },
            set({ data }: EditorResult<Data>, value: string) {
              data.content = value;
            }
          },
          binding: {
            with: 'data.content',
            schema: {
              type: 'string'
            }
          }
        },
      ];
    }
  }
};
