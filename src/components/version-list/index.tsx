import React, { useEffect, useId, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { Spin } from "antd";
import type { VersionRecord } from "../../mix/context";
import InfiniteScroll from "../../mix/lowcodeView/infinite-scroll";
import { getLazyCss } from "../../mix/lowcodeView/utils/css";
import * as lazyCss from "./index.lazy.less";

const css = getLazyCss(lazyCss);

const TYPE_LABEL: Record<VersionRecord["type"], string> = {
  init: "初始版本",
  manual: "手动编辑版本",
  ai: "AI修改版本",
  rollback: "回滚版本",
};

interface PopconfirmProps {
  title: string;
  visible: boolean;
  onVisible: (v: boolean) => void;
  onConfirm: () => void;
  children: React.ReactElement;
  parentElement?: HTMLDivElement | null;
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
        position: "fixed",
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.top + 6,
        zIndex: 99999,
      });
    };

    updatePosition();

    const handleClickOutside = (e: MouseEvent) => {
      if (triggerRef.current && triggerRef.current.contains(e.target as Node)) return;
      if (popupRef.current && popupRef.current.contains(e.target as Node)) return;
      onVisible(false);
    };

    document.addEventListener("mousedown", handleClickOutside);

    const scrollParents: Array<HTMLElement | Window> = [];
    if (parentElement) {
      scrollParents.push(parentElement);
    }
    scrollParents.push(window);
    scrollParents.forEach((p) => p.addEventListener("scroll", updatePosition, true));

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      scrollParents.forEach((p) => p.removeEventListener("scroll", updatePosition, true));
    };
  }, [visible, onVisible, parentElement]);

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

  const popup = visible
    ? ReactDOM.createPortal(
        <div ref={popupRef} className={css["popconfirm-popup"]} style={popupStyle}>
          <div className={css["popconfirm-title"]}>{title}</div>
          <div className={css["popconfirm-actions"]}>
            <button type="button" className={css["popconfirm-cancel"]} onClick={handleCancel}>
              取消
            </button>
            <button type="button" className={css["popconfirm-confirm"]} onClick={handleConfirm}>
              确认
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <span ref={triggerRef} className={css["popconfirm-wrap"]}>
      {trigger}
      {popup}
    </span>
  );
}

interface VersionItemProps {
  version: VersionRecord;
  isCurrent: boolean;
  itemCls: string;
  dotCls: string;
  tagCls: string;
  parentElement?: HTMLDivElement | null;
  onRollback: (v: VersionRecord) => void;
}

function VersionItem({
  version,
  isCurrent,
  itemCls,
  dotCls,
  tagCls,
  parentElement,
  onRollback,
}: VersionItemProps) {
  const [popconfirmVisible, setPopconfirmVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isMouseInRef = useRef(false);

  useEffect(() => {
    if (!popconfirmVisible && !isMouseInRef.current) {
      setIsHovered(false);
    }
  }, [popconfirmVisible]);

  const isActive = isHovered || popconfirmVisible;

  const timeStr = new Date(version.createdAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      className={[itemCls, isActive ? css["version-item-active"] : ""].filter(Boolean).join(" ")}
      onMouseEnter={() => {
        isMouseInRef.current = true;
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        isMouseInRef.current = false;
        if (!popconfirmVisible) {
          setIsHovered(false);
        }
      }}
    >
      <div className={css["version-info"]}>
        <div className={css["version-main-row"]}>
          <div className={dotCls} />
          <span className={css["version-label"]}>{version.label}</span>
          <span className={tagCls}>{TYPE_LABEL[version.type]}</span>
          <span className={css["version-time"]}>{timeStr}</span>
        </div>
        {version.summary && <div className={css["version-summary"]}>{version.summary}</div>}
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
            <button type="button" className={css["version-rollback-btn"]}>
              回滚
            </button>
          </Popconfirm>
        </div>
      )}
    </div>
  );
}

export interface VersionListViewProps {
  versions: VersionRecord[];
  onRollback: (version: VersionRecord) => void;
  enableInfiniteScroll?: boolean;
  loading?: boolean;
  hasMore?: boolean;
  loadMore?: () => void | Promise<void>;
  scrollableTarget?: string;
}

export default function VersionListView({
  versions,
  onRollback,
  enableInfiniteScroll = true,
  loading = false,
  hasMore = false,
  loadMore,
  scrollableTarget,
}: VersionListViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const autoTargetId = useId().replace(/:/g, "-");
  const targetId = scrollableTarget ?? autoTargetId;
  const useInfiniteScroll = enableInfiniteScroll && typeof loadMore === "function";

  const renderItems = () => {
    if (!versions.length) {
      return <div className={css["version-empty"]}>暂无版本</div>;
    }

    return versions.map((version, index) => {
      const isCurrent = index === 0;
      const itemCls = [css["version-item"], isCurrent ? css["version-item-current"] : ""]
        .filter(Boolean)
        .join(" ");

      const dotCls = [css["version-dot"], css[`version-dot-${version.type}`]]
        .filter(Boolean)
        .join(" ");

      const tagCls = [css["version-type-tag"], css[`version-type-tag-${version.type}`]]
        .filter(Boolean)
        .join(" ");

      return (
        <VersionItem
          key={version.id}
          version={version}
          isCurrent={isCurrent}
          itemCls={itemCls}
          dotCls={dotCls}
          tagCls={tagCls}
          onRollback={onRollback}
          parentElement={rootRef.current}
        />
      );
    });
  };

  return (
    <div className={css["version-list"]} id={targetId} ref={rootRef}>
      {useInfiniteScroll ? (
        <InfiniteScroll
          loading={loading}
          scrollableTarget={targetId}
          dataLength={versions.length}
          hasMore={hasMore}
          loader={
            <p className={css.loading}>
              <Spin />
            </p>
          }
          endMessage={<p className={css.noMore}>- 没有更多了 -</p>}
          next={loadMore!}
        >
          {renderItems()}
        </InfiniteScroll>
      ) : (
        renderItems()
      )}
    </div>
  );
}
