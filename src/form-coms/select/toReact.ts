export default function ({ data }) {
    const str = `<Select/>`

    return {
        imports: [
            {
                from: 'antd',
                coms: ['Select']
            }
        ],
        jsx: str,
        style: '',
        js: ''
    }
}