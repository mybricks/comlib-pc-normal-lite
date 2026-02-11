export default {
  description: `树形控件`,
  editors: {
    ':root': {
      title: '树形控件',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['background'],
            }
          ]
        }
      ]
    },
    '.ant-tree .ant-tree-switcher': {
      title: '节点开关',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font'],
            }
          ]
        }
      ]
    },
    '.ant-tree .ant-tree-node-content-wrapper': {
      title: '节点内容',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['font', 'padding'],
            }
          ]
        }
      ]
    },
    '.ant-tree .ant-tree-indent-unit': {
      title: '缩进',
      style: [
        {
          items: [
            {
              title: '样式',
              options: ['size'],
            }
          ]
        }
      ]
    }
  },
  docs: require('./Tree.md').default
}