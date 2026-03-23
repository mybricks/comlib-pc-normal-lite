import React, { useState, useEffect, useCallback } from "react";
import context from "../../context";
import type { VersionSnapshot, VersionState } from "../../context";
import lazyCss from "./index.lazy.less";

const css = lazyCss.locals;

interface VersionPanelProps {
  componentId: string;
}

const TYPE_LABEL: Record<VersionSnapshot['type'], string> = {
  init: '初始化',
  editor: '编辑器',
  ai: 'AI',
};

export default function VersionPanel({ componentId }: VersionPanelProps) {
  const [versionState, setVersionState] = useState<VersionState>(() =>
    context.getVersionHistory(componentId)
  );

  useEffect(() => {
    if (!componentId) return;

    // 先注册变更监听
    const off = context.getVersionStateEvents(componentId).on(
      'change',
      (state) => setVersionState({ ...state }),
      false
    );

    // 面板挂载时确保 V0 已初始化（幂等），初始化完成后同步最新状态
    context.initVersion(componentId);
    setVersionState({ ...context.getVersionHistory(componentId) });

    return () => off();
  }, [componentId]);

  const handleRollback = useCallback((versionId: string) => {
    if (!window.confirm('确认回滚到该版本？回滚后该版本之后的内容将被删除，且操作不可撤销，请谨慎操作。')) return;
    context.rollbackToVersion(componentId, versionId);
  }, [componentId]);

  const { versions } = versionState;

  // 倒序展示（最新在上），pending 条目在最顶部
  const sorted = [...versions].reverse();

  // 第一条非 pending 的版本为"当前版本"
  const currentVersionId = sorted.find(v => !v.isPending)?.id;

  return (
    <div className={css['version-panel']}>
      <div className={css['version-header']}>版本历史</div>
      <div className={css['version-list']}>
        {sorted.length === 0 && (
          <div className={css['version-empty']}>暂无版本记录</div>
        )}
        {sorted.map((version) => {
          const isCurrent = version.id === currentVersionId;
          const itemCls = [
            css['version-item'],
            isCurrent ? css['version-item-current'] : '',
            version.isPending ? css['version-item-pending'] : '',
          ].filter(Boolean).join(' ');

          const dotCls = [
            css['version-dot'],
            version.isPending
              ? css['version-dot-pending']
              : css[`version-dot-${version.type}`],
          ].filter(Boolean).join(' ');

          const tagCls = [
            css['version-type-tag'],
            css[`version-type-tag-${version.type}`],
          ].join(' ');

          return (
            <div key={version.id} className={itemCls}>
              <div className={dotCls} />
              <div className={css['version-info']}>
                <div className={css['version-label']}>{version.label}</div>
                <div className={css['version-meta']}>
                  <span className={tagCls}>{TYPE_LABEL[version.type]}</span>
                  {version.isPending ? (
                    <span className={css['version-generating']}>生成中...</span>
                  ) : (
                    <span className={css['version-time']}>{version.timestamp}</span>
                  )}
                </div>
              </div>
              {/* 非 pending、非当前版本才显示回滚按钮 */}
              {!version.isPending && !isCurrent && (
                <button
                  type="button"
                  className={css['version-rollback-btn']}
                  onClick={() => handleRollback(version.id)}
                >
                  回滚
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
