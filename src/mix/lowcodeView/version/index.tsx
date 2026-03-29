import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
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

interface PopconfirmProps {
  title: string;
  visible: boolean;
  onVisible: (v: boolean) => void;
  onConfirm: () => void;
  children: React.ReactElement;
}

function Popconfirm({ title, visible, onVisible, onConfirm, children }: PopconfirmProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!visible) return;

    const updatePosition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPopupStyle({
        position: 'fixed',
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.top + 6,
        zIndex: 99999,
      });
    };

    updatePosition();

    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current && triggerRef.current.contains(e.target as Node)
      ) return;
      if (
        popupRef.current && popupRef.current.contains(e.target as Node)
      ) return;
      onVisible(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [visible, onVisible]);

  const handleTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    onVisible(true);
  };

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    onVisible(false);
    onConfirm();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onVisible(false);
  };

  const trigger = React.cloneElement(children, { onClick: handleTrigger });

  const popup = visible ? ReactDOM.createPortal(
    <div ref={popupRef} className={css['popconfirm-popup']} style={popupStyle}>
      <div className={css['popconfirm-title']}>{title}</div>
      <div className={css['popconfirm-actions']}>
        <button type="button" className={css['popconfirm-cancel']} onClick={handleCancel}>取消</button>
        <button type="button" className={css['popconfirm-confirm']} onClick={handleConfirm}>确认</button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <span ref={triggerRef} className={css['popconfirm-wrap']}>
      {trigger}
      {popup}
    </span>
  );
}

function VersionItem({
  version,
  isCurrent,
  itemCls,
  dotCls,
  tagCls,
  onRollback,
}: {
  version: VersionSnapshot;
  isCurrent: boolean;
  itemCls: string;
  dotCls: string;
  tagCls: string;
  onRollback: (v: VersionSnapshot) => void;
}) {
  const [popconfirmVisible, setPopconfirmVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isActive = isHovered || popconfirmVisible;

  return (
    <div
      className={[itemCls, isActive ? css['version-item-active'] : ''].filter(Boolean).join(' ')}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setPopconfirmVisible(false); }}
    >
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
        <Popconfirm
          title="确认回滚到该版本？该版本之后的内容将被删除且不可撤销。"
          visible={popconfirmVisible}
          onVisible={setPopconfirmVisible}
          onConfirm={() => onRollback(version)}
        >
          <button
            type="button"
            className={css['version-rollback-btn']}
            style={{ visibility: (isHovered || popconfirmVisible) ? 'visible' : 'hidden' }}
          >
            回滚
          </button>
        </Popconfirm>
      )}
    </div>
  );
}

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
              <VersionItem
                key={version.id}
                version={version}
                isCurrent={isCurrent}
                itemCls={itemCls}
                dotCls={dotCls}
                tagCls={tagCls}
                onRollback={handleRollback}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
