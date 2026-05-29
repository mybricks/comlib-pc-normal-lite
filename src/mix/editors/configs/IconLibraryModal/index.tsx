import React, { useState, useEffect } from 'react';
import { Modal } from 'antd';
import { scanIconsFromDOM } from '../../styleProxy';
import { loadIconLibraries, deleteIconLibrary, type DumpIconsLibrary, type IconPanel } from './utils';
import context from '../../../context';
import AIInputBar from './AIInputBar';
import EmptyState from './EmptyState';
import IconItem from './IconItem';
import styles from './style.less';

export default function IconLibraryModal({
  visible,
  params,
  comId,
  onClose,
}: {
  visible: boolean;
  params: any;
  comId: string;
  onClose: () => void;
}) {
  const [iconPanel, setIconPanel] = useState<IconPanel>('overview');
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [iconLibraries, setIconLibraries] = useState<DumpIconsLibrary[]>([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setIconPanel('overview');
    setActiveLibraryId(null);
    (async () => {
      const libraries = await loadIconLibraries(comId);
      if (cancelled) return;
      const sortedLibraries = [...libraries].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      // 兼容旧数据：若图标库为空，回退到画布扫描结果，避免用户完全无入口。
      if (sortedLibraries.length === 0) {
        const scannedIcons = scanIconsFromDOM();
        setIconLibraries(
          scannedIcons.length > 0
            ? [{ id: '__canvas_fallback__', name: '画布中图标', updatedAt: Date.now(), icons: scannedIcons }]
            : [],
        );
      } else {
        setIconLibraries(sortedLibraries);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, comId]);

  const activeLibrary = iconLibraries.find(item => item.id === activeLibraryId);

  const handleOpenLibraryDetail = (libraryId: string) => {
    setActiveLibraryId(libraryId);
    setIconPanel('detail');
  };

  const handleBackToOverview = () => {
    setIconPanel('overview');
    setActiveLibraryId(null);
  };

  const handleDeleteLibrary = async (e: React.MouseEvent, libraryId: string) => {
    e.stopPropagation();
    await deleteIconLibrary(libraryId);
    setIconLibraries(prev => prev.filter(lib => lib.id !== libraryId));
  };

  const handleGenerateIcon = (content: string) => {
    const plugins = (context as any).plugins as any;
    const aiService = plugins?.aiService;
    plugins?.showAIDialog?.();
    try {
      const result = aiService?.request({
        message: `调用图标生成工具，生成图标，用户需求：${content}`,
        attachments: [],
      });
      if (result && typeof result.then === 'function') {
        result.then(
          (r: any) => console.log('[svgEditor] request resolved:', r),
          (e: any) => console.error('[svgEditor] request rejected:', e),
        );
      }
    } catch (e) {
      console.error('[svgEditor] AI request threw:', e);
    }
    onClose();
  };

  // 无图标库时只展示生成引导，弹窗高度自适应输入框内容；有数据时固定高度以容纳列表滚动。
  const isEmptyOverview = iconPanel === 'overview' && iconLibraries.length === 0;

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      title="从图标库选择"
      bodyStyle={isEmptyOverview ? { height: 'auto' } : { height: '520px' }}
      footer={null}
      width={560}
      destroyOnClose
    >
      <div className={isEmptyOverview ? `${styles.modalBody} ${styles.empty}` : styles.modalBody}>
        {iconPanel === 'overview' && (
          <>
            {iconLibraries.length > 0 ? (
              <>
                <div className={styles.overviewGrid}>
                  {iconLibraries.map(library => (
                    <div
                      key={library.id}
                      className={styles.libraryCard}
                      onClick={() => handleOpenLibraryDetail(library.id)}
                    >
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={e => handleDeleteLibrary(e, library.id)}
                        aria-label="删除图标库"
                      >
                        <svg viewBox="0 0 16 16" width={12} height={12} fill="currentColor">
                          <path d="M2.293 2.293a1 1 0 0 1 1.414 0L8 6.586l4.293-4.293a1 1 0 1 1 1.414 1.414L9.414 8l4.293 4.293a1 1 0 0 1-1.414 1.414L8 9.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L6.586 8 2.293 3.707a1 1 0 0 1 0-1.414z" />
                        </svg>
                      </button>
                      <div className={styles.libraryName} title={library.name || '未命名图标库'}>
                        {library.name || '未命名图标库'}
                      </div>
                      <div className={styles.previewWrap}>
                        <div className={styles.previewGrid}>
                          {library.icons.slice(0, 9).map((icon, index) => (
                            <div key={`${icon.id ?? icon.name}-${index}`} className={styles.previewItem}>
                              <div
                                className={styles.previewSvg}
                                dangerouslySetInnerHTML={{ __html: icon.svg }}
                              />
                            </div>
                          ))}
                        </div>
                        {library.icons.length > 9 && (
                          <div className={styles.previewFade} />
                        )}
                      </div>
                      <div className={styles.libraryCount}>
                        共 {library.icons.length} 个图标
                      </div>
                    </div>
                  ))}
                </div>
                <div className={styles.aiInputSection}>
                  <AIInputBar
                    onGenerate={handleGenerateIcon}
                    placeholder="告诉 AI 你还需要什么图标库…"
                  />
                </div>
              </>
            ) : (
              <EmptyState onClose={onClose} />
            )}
          </>
        )}
        {iconPanel === 'detail' && (
          <div className={styles.detailWrap}>
            <div className={styles.detailHeader}>
              <span className={styles.backBtn} onClick={handleBackToOverview}>
                ← 返回
              </span>
              <span className={styles.detailTitle}>{activeLibrary?.name || '图标库'}</span>
            </div>
            <div className={styles.detailGrid}>
              {(activeLibrary?.icons ?? []).map((icon, index) => (
                <IconItem
                  key={`${icon.id ?? icon.name}-${index}`}
                  icon={icon}
                  params={params}
                  onClose={onClose}
                />
              ))}
              {(activeLibrary?.icons?.length ?? 0) === 0 && (
                <div className={styles.emptyTip}>当前图标库暂无图标</div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
