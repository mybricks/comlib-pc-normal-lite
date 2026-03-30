import React from 'react';

const spinStyle: React.CSSProperties = {
  marginRight: 5,
  animation: 'vibeui-spin 0.8s linear infinite',
  display: 'inline-block',
  verticalAlign: 'middle',
};

const SpinIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={spinStyle}>
    <style>{`@keyframes vibeui-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
);

interface Props {
  buttonStyle: React.CSSProperties;
  focusArea: any;
  comId: string;
}

export function ExportFigmaBtn({ buttonStyle, focusArea, comId }: Props) {
  const [loading, setLoading] = React.useState(false);

  const handleClick = () => {
    if (loading) return;
    const fn = (window as any).elementToMybricksJsonWithInlineImages;
    if (typeof fn !== 'function') {
      console.warn('[导出页面] window.elementToMybricksJsonWithInlineImages 未定义');
      return;
    }
    const ele = focusArea?.ele;
    if (!ele) {
      console.warn('[导出页面] focusArea.ele 不存在');
      return;
    }
    const message = (window as any).antd?.message;
    setLoading(true);
    fn(ele, comId)
      .then((result: any) => {
        const jsonStr = JSON.stringify(result, null, 2);
        return navigator.clipboard.writeText(jsonStr);
      })
      .then(
        () => {
          setLoading(false);
          if (message) message.success('内容已复制到剪切板，请在Figma打开MyBricks插件，粘贴后点击生成页面');
          else alert('内容已复制到剪切板，请在Figma打开MyBricks插件，粘贴后点击生成页面');
        },
        (err: any) => {
          setLoading(false);
          if (message) message.error('导出失败，请检查剪切板权限');
          else alert('导出失败，请检查剪切板权限');
          console.error('[导出页面] 复制失败', err);
        }
      );
  };

  return (
    <div style={{ padding: '4px 0' }}>
      <button
        type="button"
        disabled={loading}
        onClick={handleClick}
        style={{ ...buttonStyle, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
      >
        {loading ? <><SpinIcon />导出中...</> : '导出到 Figma'}
      </button>
    </div>
  );
}
