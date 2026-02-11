export default {
  description: `输入框`,
  editors: {
    ':root': {
      title: '输入框',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'background', 'border'],
            }
          ]
        }
      ]
    },
    // '.ant-input': {
    //   title: '输入框',
    //   style: [
    //     {
    //       items: [
    //         {
    //           title: '样式',
    //           options: ['font', 'background', 'border'],
    //         }
    //       ]
    //     }
    //   ]
    // },
    // '.ant-input-password': {
    //   title: '密码输入框',
    //   style: [
    //     {
    //       items: [
    //         {
    //           title: '样式',
    //           options: ['font', 'background', 'border'],
    //         }
    //       ]
    //     }
    //   ]
    // },
  },
  docs: require('./Input.md').default
}