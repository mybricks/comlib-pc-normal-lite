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
    const isAntdIcon = data.icon && /^[A-Z]/.test(data.icon);

    let jsx = '';

    if (isAntdIcon) {
        // 使用 Ant Design 图标
        jsx = `<${data.icon} style={${getObjectStr(style)}} />`;
    } else {
        // 自定义 HTML/SVG 图标
        jsx = `<div 
  style={${getObjectStr(style)}} 
  dangerouslySetInnerHTML={{ __html: ${JSON.stringify(data.icon)} }}
/>`;
    }

    return {
        imports: [
            {
                from: '@ant-design/icons',
                coms: [data.icon]
            },
            {
                from: 'react',
                coms: ['React']
            }
        ],
        jsx,
        style: ``,
        js:``
    };
}

function getObjectStr(obj) {
    return JSON.stringify(obj, null, 2);
}
