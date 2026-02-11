export default {
  description: `网格布局`,
  editors: {
    ':root': {
      title: '行列',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background', 'border'],
            }
          ]
        }
      ]
    },
    // '.ant-col': {
    //   title: '列',
    //   style: [
    //     {
    //       items: [
    //         {
    //           title: '样式',
    //           options: ['background', 'border'],
    //         }
    //       ]
    //     }
    //   ]
    // },
    // '.ant-row': {
    //   title: '行',
    //   style: [
    //     {
    //       items: [
    //         {
    //           title: '样式',
    //           options: ['background', 'border'],
    //         }
    //       ]
    //     }
    //   ]
    // },
  },
  docs: require('./Grid.md').default
}