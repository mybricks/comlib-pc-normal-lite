export default function ({ data }) {
  // 转义特殊字符，避免破坏 JSX 结构
  const escapeContent = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/{/g, '&#123;')
      .replace(/}/g, '&#125;');
  };

  const content = escapeContent(data.content);

  const jsx = `<Typography.Text className="text">
  ${content}
</Typography.Text>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Typography']
      }
    ],
    jsx,
    style: ``,
    js: ''
  };
}