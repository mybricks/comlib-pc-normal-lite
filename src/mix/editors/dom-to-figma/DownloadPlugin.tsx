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
}

function showInstallModal() {
  const Modal = (window as any).antd?.Modal;
  const h = (window as any).React?.createElement;
  if (!Modal || !h) return;

  const wrapCls = 'vibeui-modal-rounded';
  if (!document.getElementById(wrapCls)) {
    const s = document.createElement('style');
    s.id = wrapCls;
    s.textContent = `.${wrapCls} .ant-modal-content { border-radius: 15px !important; overflow: hidden; }`;
    document.head.appendChild(s);
  }

  const InfoCircleOutlined = (window as any).icons?.InfoCircleOutlined;
  const icon = InfoCircleOutlined ? h(InfoCircleOutlined, { style: { color: 'var(--mybricks-color-primary)' } }) : null;

  Modal.info({
    title: 'VibeUI Figma 插件使用教程',
    width: 520,
    okText: '知道了',
    wrapClassName: wrapCls,
    icon,
    okButtonProps: {
      style: {
        backgroundColor: 'var(--mybricks-color-primary)',
        borderColor: 'var(--mybricks-color-primary)',
        borderRadius: '8px',
      },
    },
    content: h('div', { style: { lineHeight: '1.8', fontSize: '14px' } },
      h('div', { style: { marginBottom: 12, padding: '10px 12px', backgroundColor: 'var(--mybricks-background2, #f5f7fa)', borderRadius: 8 } },
        h('div', { style: { fontSize: 13, color: 'var(--mybricks-font-color2, #666)', marginBottom: 6 } },
          '下载完成后，点击浏览器右上角的', h('b', null, '下载图标'), '，找到 ', h('b', null, 'VibeUI.zip'), ' 文件：'),
        h('img', { src: 'https://p66-ec.becukwai.com/udata/pkg/eshop/VibeUI/image001.png', style: { width: '100%', borderRadius: 6, border: '1px solid var(--mybricks-border-color, #e0e0e0)', display: 'block' } }),
      ),
      h('h3', { style: { marginTop: 12, marginBottom: 4 } }, '安装步骤'),
      h('ol', { style: { paddingLeft: 20 } },
        h('li', null, '解压下载的 ', h('b', null, 'VibeUI.zip')),
        h('li', null, '打开 Figma，点击菜单 ', h('b', null, 'Plugins → Development → Import plugin from manifest…')),
        h('li', null, '选择解压后文件夹中的 ', h('b', null, 'manifest.json'), ' 文件'),
        h('li', null, '插件安装成功后，可在 ', h('b', null, 'Plugins → VibeUI'), ' 中找到并运行'),
      ),
      h('h3', { style: { marginTop: 12, marginBottom: 4 } }, '使用说明'),
      h('ul', { style: { paddingLeft: 20 } },
        h('li', null, '在 灵创 画布中选中页面，点击 ', h('b', null, '导出到 Figma'), '，内容将复制到剪切板'),
        h('li', null, '打开 Figma，启动 VibeUI 插件，粘贴内容后点击 ', h('b', null, '生成页面')),
        h('li', null, '如需将 Figma 修改同步回 灵创，在插件中复制样式数据，回到 灵创 点击 ', h('b', null, '从 Figma 同步样式')),
      ),
    ),
  });
}

export function DownloadFigmaPlugin({ buttonStyle }: Props) {
  const [loading, setLoading] = React.useState(false);

  const handleClick = () => {
    if (loading) return;
    const url = 'https://p66-ec.becukwai.com/udata/pkg/eshop/VibeUI/1.0.0/VibeUI.zip';
    const message = (window as any).antd?.message;
    setLoading(true);
    fetch(url)
      .then(res => res.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'VibeUI.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        setLoading(false);
        if (message) message.success('VibeUI Figma插件下载成功，请打开下载文件夹查看');
        showInstallModal();
      })
      .catch(() => {
        window.open(url, '_blank');
        setLoading(false);
        if (message) message.success('已在新标签页中开始下载');
        showInstallModal();
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
        {loading ? <><SpinIcon />下载中...</> : '下载 Figma 插件'}
      </button>
    </div>
  );
}
