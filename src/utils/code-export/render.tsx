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

  const handleSelectDir = useCallback(async () => {
    const selectFolderPath = (window as any).selectFolderPath;
    if (typeof selectFolderPath !== 'function') return;
    try {
      const newDir: string = await selectFolderPath();
      if (newDir) {
        const aiComParams = context.getAiComParams(comId);
        if (aiComParams?.data) {
          aiComParams.data.exportOutputDir = newDir;
          context.getAiCom(comId)?.actions?.notifyChanged?.();
        }
      }
    } catch (error) {
      if (!(error as any)?.message?.includes('取消')) {
        console.error('[选择目录] 失败', error);
      }
    }
  }, [comId]);

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

    try {
      const files = generateCodeStructure(aiComParams.data, { type });
      const usedDir = await exportCode(files, {
        folderName: 'App',
        outputDir: isVSCode ? outputDir : undefined,
        onProgress: (progress) => {
          console.log(`[导出进度] ${progress.progress}% - ${progress.currentFile}`);
        },
      });

      setLoadingType(null);

      // VSCode 环境下记录路径
      if (isVSCode && usedDir && usedDir !== outputDir) {
        aiComParams.data.exportOutputDir = usedDir;
        context.getAiCom(comId)?.actions?.notifyChanged?.();
      }

      const successMsg = isVSCode && usedDir ? `导出代码成功！路径：${usedDir}` : '导出代码成功！';
      if (message) message.success(successMsg);
      else alert(successMsg);
    } catch (error) {
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
          title={`${outputDir}\n点击重新选择目录`}
          role="button"
          tabIndex={0}
          onClick={handleSelectDir}
          onKeyDown={(e) => e.key === 'Enter' && handleSelectDir()}
          style={{
            marginTop: 8,
            backgroundColor: 'var(--mybricks-bg-color-hover)',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            cursor: 'pointer',
          }}
        >
          <div style={{
            fontWeight: 500,
            color: 'var(--mybricks-text-color-main)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {outputDir === '.' ? '根目录' : (outputDir.split('/').pop() || outputDir)}
          </div>
          <div style={{
            color: 'var(--mybricks-text-color-main)',
            opacity: 0.45,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {outputDir === '.' ? '.' : (outputDir.split('/').slice(0, -1).join('/') || '/')}
          </div>
        </div>
      )}
    </div>
  );
}
