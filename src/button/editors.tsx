export default {
  '@init'({ style }) {
    style.width = "auto";
    style.height = "auto";
  },
  '@resize': {
    options: ['width', 'height']
  },
  ':root': {
    items: [
      {
        title: '按钮文案',
        type: 'text',
        value: {
          get({ data }) {
            return data.text;
          },
          set({ data }, value: string) {
            data.text = value;
          }
        }
      },
    ],
    style: [
      {
        title: '风格',
        type: 'select',
        options: [
          {
            label: '主按钮',
            value: 'primary'
          },
          {
            label: '次按钮',
            value: 'default'
          },
          {
            label: '虚线按钮',
            value: 'dashed'
          },
          {
            label: '链接按钮',
            value: 'link'
          },
          {
            label: '文字按钮',
            value: 'text'
          }
        ],
        value: {
          get({ data }) {
            return data.type;
          },
          set({ data }, type) {
            data.type = type;
          }
        }
      }
    ]
  }
};
