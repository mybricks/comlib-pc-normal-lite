import React, { useState, useCallback } from 'react';
import { generateCodeStructure } from './structure-generator';
import { exportCode, isExportSupported } from './export';
import context from '../../mix/context';

interface ExportCodePanelProps {
  comId: string;
  data: any;
}

export default function Render({ comId, data }: ExportCodePanelProps) {
  const [loadingType, setLoadingType] = useState<'application' | 'component' | null>(null);

  const isVSCode = typeof (window as any).exportCodeToVSCode === 'function';
  const outputDir: string | undefined = data?.exportOutputDir;

  const handleExport = useCallback(async (type: 'application' | 'component') => {
    if (!comId) return;

    const aiComParams = context.getAiComParams(comId);
    if (!aiComParams?.data) {
      console.error('[导出为代码] 组件数据不存在');
      return;
    }

    if (!isExportSupported()) {
      alert('当前环境不支持导出，请使用 Chrome、Edge 或在 VSCode 中打开');
      return;
    }

    const message = (window as any).antd?.message;
    setLoadingType(type);
    let hideLoading: any = null;
    if (message) hideLoading = message.loading('正在导出代码...', 0);

    try {
      const files = generateCodeStructure(aiComParams.data, { type });
      const usedDir = await exportCode(files, {
        folderName: 'App',
        outputDir: isVSCode ? outputDir : undefined,
        onProgress: (progress) => {
          console.log(`[导出进度] ${progress.progress}% - ${progress.currentFile}`);
        },
      });

      if (hideLoading) hideLoading();
      setLoadingType(null);

      // VSCode 环境下记录路径
      if (isVSCode && usedDir && usedDir !== outputDir) {
        aiComParams.data.exportOutputDir = usedDir;
        context.getAiCom(comId)?.actions?.notifyChanged?.();
      }

      if (message) message.success('导出代码成功！');
      else alert('导出代码成功！');
    } catch (error) {
      if (hideLoading) hideLoading();
      setLoadingType(null);

      if ((error as any)?.message?.includes('取消')) {
        console.log('[导出为代码] 用户取消导出');
      } else {
        if (message) message.error(`导出失败: ${(error as any)?.message || '未知错误'}`);
        else alert(`导出失败: ${(error as any)?.message || '未知错误'}`);
        console.error('[导出为代码] 导出失败', error);
      }
    }
  }, [comId, isVSCode, outputDir]);

  const loading = loadingType !== null;

  const buttonStyle: React.CSSProperties = {
    cursor: loading ? 'not-allowed' : 'pointer',
    flex: 1,
    textAlign: 'center',
    height: 26,
    lineHeight: '26px',
    borderRadius: 6,
    border: '1px solid rgba(2, 9, 16, 0.13)',
    backgroundColor: 'var(--mybricks-bg-color-hover, #F5F5F5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    color: loading ? '#aaa' : 'var(--mybricks-text-color-main)',
    padding: 0,
    opacity: loading ? 0.6 : 1,
  };

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          disabled={loading}
          onClick={() => handleExport('application')}
          style={buttonStyle}
        >
          {loadingType === 'application' ? '导出中...' : '导出页面'}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => handleExport('component')}
          style={buttonStyle}
        >
          {loadingType === 'component' ? '导出中...' : '导出组件'}
        </button>
      </div>
      {isVSCode && outputDir && (
        <div
          title={outputDir}
          style={{
            marginTop: 8,
            padding: '6px 6px',
            fontSize: 10,
            fontStyle: 'italic',
            color: 'rgba(0,0,0,0.45)',
            backgroundColor: 'rgba(0,0,0,0.04)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            overflow: 'hidden',
          }}
        >
          <span style={{ flexShrink: 0 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.586a1 1 0 0 1 .707.293L8 3.586A1 1 0 0 0 8.707 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9Z" fill="rgba(0,0,0,0.35)"/>
            </svg>
          </span>
          {(outputDir === '.' ? ['根目录'] : outputDir.split('/')).map((seg, i, arr) => (
            <React.Fragment key={i}>
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: i === arr.length - 1 ? 1 : 0,
                color: i === arr.length - 1 ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.35)',
              }}>
                {seg}
              </span>
              {i < arr.length - 1 && (
                <span style={{ flexShrink: 0, color: 'rgba(0,0,0,0.25)' }}>/</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
