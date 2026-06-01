import React, { useState, useEffect } from 'react';
import { Modal } from 'antd';
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIconKey, setSelectedIconKey] = useState<string | null>(null);

  const refreshLibraries = async () => {
    const libraries = await loadIconLibraries(comId);
    const sortedLibraries = [...libraries].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    setIconLibraries(sortedLibraries);
  };

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setIconPanel('overview');
    setActiveLibraryId(null);
    setSelectedIconKey(null);
    (async () => {
      if (cancelled) return;
      await refreshLibraries();
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, comId]);

  // AI 修改/生成图标后自动刷新展示，不依赖弹窗重新打开
  useEffect(() => {
    const onIconsGenerated = () => {
      if (!visible) return;
      refreshLibraries();
    };
    window.addEventListener('vibe-icons-generated', onIconsGenerated);
    return () => window.removeEventListener('vibe-icons-generated', onIconsGenerated);
  }, [visible, comId]);

  const handleOpenLibraryDetail = (libraryId: string) => {
    setActiveLibraryId(libraryId);
    setIconPanel('detail');
  };

  const handleBackToOverview = () => {
    setIconPanel('overview');
    setActiveLibraryId(null);
    setSelectedIconKey(null);
  };

  const handleSelectIcon = (iconKey: string) => {
    setSelectedIconKey(prev => (prev === iconKey ? null : iconKey));
  };

  const handleDeleteLibrary = async (e: React.MouseEvent, libraryId: string) => {
    e.stopPropagation();
    setDeletingId(libraryId);
    try {
      await deleteIconLibrary(libraryId);
      setIconLibraries(prev => prev.filter(lib => lib.id !== libraryId));
    } finally {
      setDeletingId(null);
    }
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

  const activeLibrary = iconLibraries.find(item => item.id === activeLibraryId);

  const selectedIcon = (activeLibrary?.icons ?? []).find(
    (icon, index) => `${icon.id ?? icon.name}-${index}` === selectedIconKey,
  );

  const handleEditIcon = (content: string) => {
    const plugins = (context as any).plugins as any;
    const aiService = plugins?.aiService;
    plugins?.showAIDialog?.();
    const iconType = (activeLibrary as any)?.style ?? '线性';
    const prompt = [
      `修改图标「${selectedIcon?.name ?? ''}」，用户需求：${content}`,
      `调用 generate_icon 工具时必须满足：`,
      `  libraryName="${activeLibrary?.name ?? ''}"（必须与原图标库名称完全一致）`,
      `  iconType 根据用户需求决定（如"改成实心"则用"面性"，否则保持"${iconType}"）`,
      `  图标 name 必须严格等于"${selectedIcon?.name ?? ''}"，禁止修改为其他名称`,
      selectedIcon?.svg
        ? `  referenceIconSvg 传入原始 SVG 作为参考：${selectedIcon.svg}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      aiService?.request({ message: prompt, attachments: [] });
    } catch (e) {
      console.error('[svgEditor] AI edit request threw:', e);
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
                        className={`${styles.deleteBtn}${deletingId === library.id ? ` ${styles.deleteBtnLoading}` : ''}`}
                        onClick={e => handleDeleteLibrary(e, library.id)}
                        disabled={deletingId !== null}
                        aria-label="删除图标库"
                      >
                        {deletingId === library.id ? (
                          <svg viewBox="0 0 16 16" width={12} height={12} fill="currentColor" className={styles.spinIcon}>
                            <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5A.75.75 0 0 0 13 8a5 5 0 1 1-5-5 .75.75 0 0 0 0-1.5z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" width={12} height={12} fill="currentColor">
                            <path d="M2.293 2.293a1 1 0 0 1 1.414 0L8 6.586l4.293-4.293a1 1 0 1 1 1.414 1.414L9.414 8l4.293 4.293a1 1 0 0 1-1.414 1.414L8 9.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L6.586 8 2.293 3.707a1 1 0 0 1 0-1.414z" />
                          </svg>
                        )}
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
              {(activeLibrary?.icons ?? []).map((icon, index) => {
                const iconKey = `${icon.id ?? icon.name}-${index}`;
                const isActive = selectedIconKey === iconKey;
                return (
                  <button
                    key={iconKey}
                    type="button"
                    className={`${styles.iconItem}${isActive ? ` ${styles.iconItemActive}` : ''}`}
                    onClick={() => handleSelectIcon(iconKey)}
                  >
                    <div
                      className={styles.iconItemSvg}
                      dangerouslySetInnerHTML={{ __html: icon.svg }}
                    />
                    <span className={styles.iconItemName}>{icon.name}</span>
                  </button>
                );
              })}
              {(activeLibrary?.icons?.length ?? 0) === 0 && (
                <div className={styles.emptyTip}>当前图标库暂无图标</div>
              )}
            </div>
            {selectedIconKey && (
              <div className={styles.detailAISection}>
                <AIInputBar
                  onGenerate={handleEditIcon}
                  placeholder="告诉 AI 你想怎么改这个图标"
                  showPresets={false}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
