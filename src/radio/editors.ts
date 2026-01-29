import { Data } from './types';

export default {
  '@init'({ style }) {
    style.width = '100%';
  },
  '@resize': {
    options: ['width']
  },
  ':root': {
    style: [
      {
        items: [
          {
            title: '选项标签',
            catelog: '默认',
            options: ['font'],
            target: '.ant-radio-wrapper, .ant-radio-button-wrapper'
          },
          {
            title: '选项',
            catelog: '默认',
            options: [
              { type: 'background', config: { disableBackgroundImage: true } },
              'border'
            ],
            target: '.ant-radio-wrapper, .ant-radio-button-wrapper'
          }
        ]
      }
    ],
    items: ({ data, env }: EditorResult<Data>, cate1) => {
      cate1.title = '常规';
      cate1.items = [
        {
          title: '禁用状态',
          type: 'switch',
          value: {
            get({ data }) {
              return data.config.disabled;
            },
            set({ data }, value: boolean) {
              data.config.disabled = value;
            }
          }
        },
        {
          title: '静态选项配置',
          type: 'array',
          options: {
            getTitle: ({ label }) => {
              return env.i18n(label);
            },
            onAdd: () => {
              const id = Date.now();
              return {
                label: `选项${id}`,
                value: `选项${id}`,
                key: `option_${id}`
              };
            },
            items: [
              {
                title: '禁用',
                type: 'switch',
                value: 'disabled'
              },
              {
                title: '选项标签',
                type: 'textarea',
                options: {
                  locale: true
                },
                value: 'label'
              },
              {
                title: '选项值',
                type: 'valueSelect',
                options: ['text', 'number', 'boolean'],
                value: 'value'
              }
            ]
          },
          value: {
            get({ data }: EditorResult<Data>) {
              if (!data.staticOptions) {
                data.staticOptions = [{
                  label: '选项1',
                  value: '选项1',
                  key: 'option1'
                }];
              }
              return data.staticOptions;
            },
            set({ data }: EditorResult<Data>, options: any[]) {
              data.staticOptions = options;
              data.config.options = options;
            }
          },
          binding: {
            with: 'data.config.options',
            schema: {
              type: 'string'
            }
          }
        },
        {
          title: '布局',
          type: 'select',
          ifVisible({ data }: EditorResult<Data>) {
            return !data.enableButtonStyle;
          },
          options: [
            { label: '水平', value: 'horizontal' },
            { label: '垂直', value: 'vertical' }
          ],
          value: {
            get({ data }) {
              return data.layout;
            },
            set({ data }, value: string) {
              data.layout = value;
            }
          }
        },
        {
          title: '自动换行',
          type: 'switch',
          value: {
            get({ data }) {
              return data.autoBreakLine;
            },
            set({ data }, value: boolean) {
              data.autoBreakLine = value;
            }
          }
        },
        {
          title: '使用按钮样式',
          type: 'switch',
          value: {
            get({ data }) {
              return data.enableButtonStyle;
            },
            set({ data }, value: boolean) {
              data.enableButtonStyle = value;
            }
          }
        },
        {
          title: '按钮样式',
          type: 'select',
          ifVisible({ data }: EditorResult<Data>) {
            return data.enableButtonStyle;
          },
          options: [
            { label: '描边按钮', value: 'outline' },
            { label: '实心按钮', value: 'solid' }
          ],
          value: {
            get({ data }) {
              return data.buttonStyle || 'outline';
            },
            set({ data }, value: string) {
              data.buttonStyle = value;
            }
          }
        }
      ];
    }
  }
};
