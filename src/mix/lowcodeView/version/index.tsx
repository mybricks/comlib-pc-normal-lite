import React, { useState, useEffect, useCallback } from "react";
import context from "../../context";
import type { VersionSnapshot } from "../../context";
import lazyCss from "./index.lazy.less";

const css = lazyCss.locals;

interface VersionPanelProps {
  componentId: string;
}

const TYPE_LABEL: Record<VersionSnapshot['type'], string> = {
  editor: 'Editor',
  ai: 'AI',
};

export default function VersionPanel({ componentId }: VersionPanelProps) {
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);

  useEffect(() => {
    if (!componentId) {
      return
    }
    context.getVersions(componentId).then((versions) => {
      setVersions([...versions].reverse())
    })

    const off = context.getVersionStateEvents(componentId).on(
      'change',
      (versions) => {
        setVersions([...versions].reverse())
      },
      false
    );

    return () => {
      off()
    }
  }, [componentId])

  const handleRollback = useCallback((version: VersionSnapshot) => {
    if (!window.confirm('确认回滚到该版本？回滚后该版本之后的内容将被删除，且操作不可撤销，请谨慎操作。')) return;
    context.rollbackToVersion(componentId, version);
  }, [componentId]);

  return (
    <div className={css['version-panel']}>
      {versions.length === 0 ? (
        <div className={css['version-empty']}>暂无版本记录</div>
      ) : (
        <div className={css['version-list']}>
          {versions.map((version, index) => {
            const isCurrent = index === 0;
            const itemCls = [
              css['version-item'],
              isCurrent ? css['version-item-current'] : '',
            ].filter(Boolean).join(' ');

            const dotCls = [
              css['version-dot'],
              css[`version-dot-${version.type}`]
            ].filter(Boolean).join(' ');

            const tagCls = [
              css['version-type-tag'],
              css[`version-type-tag-${version.type}`],
            ].join(' ');

            return (
              <div key={version.id} className={itemCls}>
                <div className={css['version-info']}>
                  <div className={css['version-main-row']}>
                    <div className={dotCls} />
                    <span className={css['version-label']}>{version.label}</span>
                    <span className={tagCls}>{TYPE_LABEL[version.type]}</span>
                    <span className={css['version-time']}>{version.timestamp}</span>
                  </div>
                  {version.summary && (
                    <div className={css['version-summary']}>{version.summary}</div>
                  )}
                </div>
                {!isCurrent && (
                  <button
                    type="button"
                    className={css['version-rollback-btn']}
                    onClick={() => handleRollback(version)}
                  >
                    回滚
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
