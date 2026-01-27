export default function ({ data, style }) {
    const {height,width} = style
    const _style = {
        cursor: 'pointer',
        width,
        height,
        fontSize:width
    };

    let jsx = `<${data.icon} className="icon" style={${getObjectStr(_style)}} />`;

    return {
        imports: [
            {
                from: '@ant-design/icons',
                coms: [data.icon],
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
