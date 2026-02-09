const createrCatelogEditor = ({ catelog, items }: { catelog: string, items: any[] }) => {
  return items.map(item => {
    return {
      catelog,
      ...item
    }
  });
}

export default {
  ':slot': {},
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
                    title: '文本内容',
                    options: [{ type: 'font', config: { disableTextAlign: true } }],
                    target: ['.ant-select-selection-item', '.ant-select-selection-search-input']
                  },
                  {
                    title: '提示内容',
                    options: [{ type: 'font', config: { disableTextAlign: true } }],
                    target: '.ant-select-selection-placeholder'
                  },
                  {
                    title: '边框',
                    options: ['border'],
                    target: '.ant-select-selector'
                  },
                  {
                    title: '背景色',
                    options: ['background'],
                    target: '.ant-select:not(.ant-select-customize-input) .ant-select-selector'
                  },
                  {
                    title: '下拉图标',
                    options: [{ type: 'font', config: { disableTextAlign: true } }],
                    target: '.ant-select-arrow'
                  },
                  {
                    title: '清除按钮',
                    options: [{ type: 'font', config: { disableTextAlign: true } }, 'background'],
                    // target: '.anticon-close-circle',
                    target: '.ant-select-allow-clear .ant-select-clear'
                  }
                ]
              },
              {
                title: '标签',
                items: [
                  {
                    title: '标签',
                    options: [
                      'border',
                      { type: 'font', config: { disableTextAlign: true } },
                      { type: 'background', config: { disableBackgroundImage: true } }
                    ],
                    target: [
                      '.ant-select-multiple .ant-select-selection-item',
                      '.ant-select-multiple .ant-select-selection-item-remove'
                    ]
                  },
                  {
                    title: '标签-关闭图标',
                    options: [{ type: 'font', config: { disableTextAlign: true } }],
                    target: ['.ant-select-multiple .ant-select-selection-item-remove']
                  }
                ]
              },
              {
                title: '下拉区域',
                items: [
                  {
                    title: '选项',
                    options: [
                      { type: 'font', config: { disableTextAlign: true } },
                      { type: 'background', config: { disableBackgroundImage: true } }
                    ],
                    global: true,
                    target({ id }) {
                      return `.{id} div.ant-select-item.ant-select-item-option`;
                    }
                  },
                  {
                    title: '下拉区背景',
                    options: [{ type: 'background', config: { disableBackgroundImage: true } }],
                    global: true,
                    target({ id }) {
                      return `.{id}.ant-select-dropdown`;
                    }
                  },
                  {
                    title: '空白描述',
                    options: [{ type: 'font', config: { disableTextAlign: true } }],
                    global: true,
                    target({ id }) {
                      return `.{id} .ant-empty-description`;
                    }
                  }
                ]
              }
            ]
          }),
          ...createrCatelogEditor({
            catelog: 'Hover',
            items: [
              {
                title: '边框',
                options: ['border'],
                target:
                  'div.ant-select:not(.ant-select-customize-input) > div.ant-select-selector:hover',
                domTarget: 'div.ant-select-selector'
              },
              {
                title: '选项',
                options: [
                  { type: 'font', config: { disableTextAlign: true } },
                  { type: 'background', config: { disableBackgroundImage: true } }
                ],
                global: true,
                target({ id }) {
                  return `.{id} div.ant-select-item-option-active:not(.ant-select-item-option-disabled)`;
                }
              },
              {
                title: '清除按钮',
                catelog: 'Hover',
                options: [{ type: 'font', config: { disableTextAlign: true } }],
                target: '.anticon-close-circle:hover',
                domTarget: '.anticon-close-circle'
              },
              {
                title: '标签-关闭图标',
                options: [{ type: 'font', config: { disableTextAlign: true } }],
                target: ['.ant-select-multiple .ant-select-selection-item-remove:hover']
              }
            ]
          }),
          ...createrCatelogEditor({
            catelog: 'Focus',
            items: [
              {
                title: '边框',
                options: ['border', 'BoxShadow'],
                target:
                  'div.ant-select-focused:not(.ant-select-disabled).ant-select:not(.ant-select-customize-input) > div.ant-select-selector',
                domTarget: 'div.ant-select-selector'
              },
              {
                title: '选项',
                options: [
                  { type: 'font', config: { disableTextAlign: true } },
                  { type: 'background', config: { disableBackgroundImage: true } }
                ],
                global: true,
                target({ id }) {
                  return `.{id} div.ant-select-item.ant-select-item-option.ant-select-item-option-selected:not(.ant-select-item-option-disabled)`;
                }
              }
            ]
          }),
          ...createrCatelogEditor({
            catelog: 'Select',
            items: [
              {
                title: '选项',
                options: [
                  { type: 'font', config: { disableTextAlign: true } },
                  { type: 'background', config: { disableBackgroundImage: true } }
                ],
                global: true,
                target({ id }) {
                  return `.{id} div.ant-select-item.ant-select-item-option.ant-select-item-option-selected:not(.ant-select-item-option-disabled)`;
                }
              }
            ]
          }),
          ...createrCatelogEditor({
            catelog: '禁用',
            items: [
              {
                title: '表单项',
                catelog: '禁用',
                options: [
                  'border',
                  { type: 'background', config: { disableBackgroundImage: true } }
                ],
                target: [
                  '.ant-select-disabled.ant-select:not(.ant-select-customize-input) .ant-select-selector'
                ]
              },
              {
                title: '选项',
                options: [
                  { type: 'font', config: { disableTextAlign: true } },
                  { type: 'background', config: { disableBackgroundImage: true } }
                ],
                global: true,
                target({ id }) {
                  return `.{id} div.ant-select-item.ant-select-item-option.ant-select-item-option-disabled`;
                }
              }
            ]
          })
        ]
      }
    ],
    items: ({ data, env }, ...catalog) => {
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
        }
        
      ];
    }
  }
};
