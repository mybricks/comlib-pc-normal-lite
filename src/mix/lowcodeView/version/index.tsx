import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import context from "../../context";
import type { VersionRecord } from "../../context";
import * as lazyCss from "./index.lazy.less";
import { getLazyCss } from "../utils/css";

const css = getLazyCss(lazyCss)

interface VersionPanelProps {
  componentId: string;
}

const TYPE_LABEL: Record<VersionRecord['type'], string> = {
  init: '初始版本',
  manual: '手动编辑版本',
  ai: 'AI修改版本',
  rollback: '回滚版本',
};

interface PopconfirmProps {
  title: string;
  visible: boolean;
  onVisible: (v: boolean) => void;
  onConfirm: () => void;
  children: React.ReactElement;
  parentElement: HTMLDivElement
}

function Popconfirm({ title, visible, onVisible, onConfirm, children, parentElement }: PopconfirmProps) {
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

    // 监听所有祖先元素的滚动事件，实时更新 popup 位置
    const scrollParents: Array<HTMLElement | Window> = [parentElement];
    // let el: HTMLElement | null = triggerRef.current?.parentElement ?? null;
    // while (el) {
    //   console.log('[el]', el)
    //   scrollParents.push(el);
    //   el = el.parentElement;
    // }
    scrollParents.push(window);
    scrollParents.forEach(p => p.addEventListener('scroll', updatePosition, true));

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      scrollParents.forEach(p => p.removeEventListener('scroll', updatePosition, true));
    };
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
  parentElement,
  onRollback,
}: {
  version: VersionRecord;
  isCurrent: boolean;
  itemCls: string;
  dotCls: string;
  tagCls: string;
  parentElement: HTMLDivElement;
  onRollback: (v: VersionRecord) => void;
}) {
  const [popconfirmVisible, setPopconfirmVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isMouseInRef = React.useRef(false);

  React.useEffect(() => {
    if (!popconfirmVisible && !isMouseInRef.current) {
      setIsHovered(false);
    }
  }, [popconfirmVisible]);

  const isActive = isHovered || popconfirmVisible;

  const timeStr = new Date(version.createdAt).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div
      className={[itemCls, isActive ? css['version-item-active'] : ''].filter(Boolean).join(' ')}
      onMouseEnter={() => { isMouseInRef.current = true; setIsHovered(true); }}
      onMouseLeave={() => { isMouseInRef.current = false; if (!popconfirmVisible) { setIsHovered(false); } }}
    >
      <div className={css['version-info']}>
        <div className={css['version-main-row']}>
          <div className={dotCls} />
          <span className={css['version-label']}>{version.label}</span>
          <span className={tagCls}>{TYPE_LABEL[version.type]}</span>
          <span className={css['version-time']}>{timeStr}</span>
        </div>
        {version.summary && (
          <div className={css['version-summary']}>{version.summary}</div>
        )}
      </div>
      {!isCurrent && (
        <div>
          <Popconfirm
            title="确认回滚到该版本？该版本之后的内容将被删除且不可撤销。"
            visible={popconfirmVisible}
            onVisible={setPopconfirmVisible}
            onConfirm={() => onRollback(version)}
            parentElement={parentElement}
          >
            <button
              type="button"
              className={css['version-rollback-btn']}
              // style={{ visibility: (isHovered || popconfirmVisible) ? 'visible' : 'hidden' }}
            >
              回滚
            </button>
          </Popconfirm>
        </div>
      )}
    </div>
  );
}

export default function VersionPanel({ componentId }: VersionPanelProps) {
  const [versions, setVersions] = useState<VersionRecord[]>([]);

  useEffect(() => {
    if (!componentId) return;

    // 从 context 获取 history（由 sandbox 注册）
    const history = (context as any).getHistory?.(componentId);

    // 初始化加载
    if (history) {
      history.listVersions().then(async (list: VersionRecord[]) => {
        // 没有历史记录，默认加一下初始化
        if (!list.length) {
          const data = context.getAiComParams(componentId)?.data;
          const files = (data?.files ?? [])
            .filter((f: any) => f.source)
            .map((f: any) => ({
              path: f.fileName,
              content: decodeURIComponent(f.source),
            }));
          const record = {
            id: crypto.randomUUID(),
            turnId: '',
            label: `V${0}`,
            type: 'init' as const,
            createdAt: Date.now(),
          };
          await history.addVersion(record, files);
          return setVersions([record])
        }

        return setVersions([...list].reverse())
      });
    }

    const off = context.getVersionStateEvents(componentId).on(
      'change',
      (list) => {
        setVersions([...list].reverse());
      },
      false
    );

    return () => {
      off();
    };
  }, [componentId]);

  const handleRollback = useCallback((version: VersionRecord) => {
    const rollback = (context as any).getRollback?.(componentId);
    rollback?.(version.id);
  }, [componentId]);

  const panelContainer = useRef<HTMLDivElement>(null)

  return (
    <div ref={panelContainer} className={css['version-panel']}>
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
                parentElement={panelContainer.current!}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
