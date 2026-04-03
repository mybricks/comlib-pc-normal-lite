import React, { useState, useCallback } from 'react';
import { MarkdownViewModal } from '../markdown-view';
import { RequirementViewModal } from '../requirement-view';
import { generateCodeStructure } from './structure-generator';
import { exportCode, isExportSupported } from './export';
import context from '../../mix/context';

interface ExportCodePanelProps {
  comId: string;
  data: any;
}

const buttonStyle: React.CSSProperties = {
  cursor: 'pointer',
  width: '100%',
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
  color: 'var(--mybricks-text-color-main)',
  padding: 0,
  boxSizing: 'border-box',
};

// ─── 查看文档按钮 ────────────────────────────────────────────────────────────

interface ViewDocsBtnProps {
  comId: string;
}

export function ViewDocsBtn({ comId }: ViewDocsBtnProps) {
  const [visible, setVisible] = useState(false);

  const readmeContent = React.useMemo(() => {
    try {
      const aiComParams = context.getAiComParams(comId);
      const files = aiComParams?.data?.files as any[] | undefined;
      if (!files) return '';
      const readmeFile = files.find(
        (f: any) => f.fileName === 'README.md' || f.fileName === 'readme.md'
      );
      return decodeURIComponent(readmeFile?.source ?? '');
    } catch {
      return '';
    }
  }, [comId]);

  if (!readmeContent) return null;

  return (
    <div style={{ padding: '4px 0' }}>
      <button
        type="button"
        onClick={() => setVisible(true)}
        style={buttonStyle}
      >
        查看PRD文档
      </button>
      {visible && (
        <MarkdownViewModal
          content={readmeContent}
          onClose={() => setVisible(false)}
        />
      )}
    </div>
  );
}

// ─── 查看需求按钮 ────────────────────────────────────────────────────────────

export function ViewRequirementBtn({ comId }: ViewDocsBtnProps) {
  const [visible, setVisible] = useState(false);

  const requirementCompiled = React.useMemo(() => {
    try {
      const aiComParams = context.getAiComParams(comId);
      const files = aiComParams?.data?.files as any[] | undefined;
      if (!files) return null;
      const reqFile = files.find((f: any) => f.fileName === 'requirement.md');
      return reqFile?.compiled ?? null;
    } catch {
      return null;
    }
  }, [comId]);

  if (!requirementCompiled) return null;

  return (
    <div style={{ padding: '4px 0' }}>
      <button
        type="button"
        onClick={() => setVisible(true)}
        style={buttonStyle}
      >
        查看需求文档
      </button>
      {visible && (
        <RequirementViewModal
          compiled={requirementCompiled}
          onClose={() => setVisible(false)}
        />
      )}
    </div>
  );
}

// ─── 导出面板 ─────────────────────────────────────────────────────────────────

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

  const exportBtnStyle: React.CSSProperties = {
    ...buttonStyle,
    cursor: loading ? 'not-allowed' : 'pointer',
    flex: 1,
    color: loading ? '#aaa' : 'var(--mybricks-text-color-main)',
    opacity: loading ? 0.6 : 1,
  };

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          disabled={loading}
          onClick={() => handleExport('application')}
          style={exportBtnStyle}
        >
          {loadingType === 'application' ? '导出中...' : '导出'}
        </button>
        {/* <button
          type="button"
          disabled={loading}
          onClick={() => handleExport('component')}
          style={exportBtnStyle}
        >
          {loadingType === 'component' ? '导出中...' : '导出组件'}
        </button> */}
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
