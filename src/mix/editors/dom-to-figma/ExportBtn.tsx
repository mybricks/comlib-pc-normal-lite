import React from 'react';

const SpinIcon = () => {
  React.useEffect(() => {
    if (!document.getElementById('vibeui-spin-keyframes')) {
      const s = document.createElement('style');
      s.id = 'vibeui-spin-keyframes';
      s.textContent = '@keyframes vibeui-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
  }, []);

  return (
    <span style={{
      display: 'inline-block',
      width: 12,
      height: 12,
      marginRight: 5,
      verticalAlign: 'middle',
      flexShrink: 0,
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      borderRadius: '50%',
      animation: 'vibeui-spin 0.7s linear infinite',
      willChange: 'transform',
    }} />
  );
};

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
    // 双 rAF：第一帧让 React flush loading 状态，第二帧让浏览器完成绘制，之后再执行同步 DOM 遍历
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
      // 先清空剪切板，防止导出失败时用户误用旧 JSON
      navigator.clipboard.writeText('').catch(() => {});
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
      });
    });
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
