export default function ({ data }) {
  // 处理样式
  const style = {
    cursor: 'pointer',
    fontSize: data.styleWidth === 'fit-content' ? '32px' : data.styleWidth || '32px',
    ...data.style
  };

  // 清理编辑器特有属性
  if (Object.hasOwn(style, 'styleEditorUnfold')) {
    delete style.styleEditorUnfold;
  }

  // 判断图标类型：Ant Design 图标 or 自定义 SVG/HTML
//   const isAntdIcon = data.icon && /^[A-Z]/.test(data.icon);

    // 使用 Ant Design 图标 - 关键：用组件变量名，不是字符串
    let  jsx = `<HomeOutlined style={${getObjectStr(style)}} />`;

  return {
    imports: [
      {
        from: 'react',
        coms: ['React']
      },
    {
        from: '@ant-design/icons',
        coms: ['HomeOutlined'],
      }
    ],
    jsx,
    style: '',
    js: ''
  };
}

function getObjectStr(obj) {
  return JSON.stringify(obj, null, 2);
}
