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
  '@init'({ style }) {
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
                title: '控件',
                options: [
                  'border',
                  { type: 'background', config: { disableBackgroundImage: true } }
                ],
                target: '.ant-switch-handle:before'
              },

              {
                title: '激活',
                options: [
                  'border',
                  { type: 'background', config: { disableBackgroundImage: true } }
                ],
                target: '.ant-switch-checked'
              },
              {
                title: '非激活',
                options: [
                  'border',
                  { type: 'background', config: { disableBackgroundImage: true } }
                ],
                target: '.ant-switch'
              }
            ]
          }),
        ]
      }
    ],
    items: ({ data }, ...catalog) => {
      catalog[0].title = '常规';

      catalog[0].items = [
        
        
      ];
    }
  }
};
