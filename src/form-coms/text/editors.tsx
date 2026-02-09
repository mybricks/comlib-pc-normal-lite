const createrCatelogEditor = ({ catelog, items, ifVisible }: { catelog: string, items: any[], ifVisible?: (e: any) => boolean }) => {
  return items.map(item => {
      return {
          catelog,
          ifVisible,
          ...item
      }
  });
};
export default {
  '@resize': {
    options: ['width']
  },
  '@init': ({ style }) => {
    style.width = '100%';
  },
  ':root': {
    style: [
      {
        items: [
          ...createrCatelogEditor({
            catelog: '默认',
            items: [
              {
                title: '表单项',
                items: [
                  {
                    title: '边框',
                    options: ['border'],
                    target: '.ant-input-affix-wrapper'
                  },
                  {
                    title: '背景色',
                    options: ['background'],
                    target: ['.ant-input-affix-wrapper', '.ant-input-affix-wrapper>input.ant-input']
                  },
                  {
                    title: '文本内容',
                    options: [{ type: 'font', config: { disableTextAlign: true } }],
                    target: '.ant-input'
                  },
                  {
                    title: '提示内容',
                    options: [{ type: 'font', config: { disableTextAlign: true } }],
                    target: 'input::placeholder'
                  }
                ]
              },
            ]
          }),
        ]
      }
    ],
    items: ({ data }: EditorResult<{ type }>, ...catalog) => {
      catalog[0].title = '常规';

      catalog[0].items = [
        {
          title: '提示内容',
          type: 'Text',
          options: {
            locale: true
          },
          description: '该提示内容会在值为空时显示',
          value: {
            get({ data }) {
              return data.config.placeholder;
            },
            set({ data }, value: string) {
              data.config.placeholder = value;
            }
          }
        },
      ];
    }
  }
};
