import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import { Spin } from "antd";
import context from "../../context";
import type { VersionRecord } from "../../context";
import { Version } from "../../context";
import * as lazyCss from "./index.lazy.less";
import { getLazyCss } from "../utils/css";
import { randomUUID } from "../../utils/uuid"
import InfiniteScroll from '../infinite-scroll'

const css = getLazyCss(lazyCss)

const PAGE_SIZE = 3;

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

export default function ({ componentId, render }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (render) {
      setShow(true)
    }
  }, [render])

  return show && <VersionPanel2 componentId={componentId}/>
}

function VersionPanel2({ componentId }: VersionPanelProps) {
  const panelContainer = useRef<HTMLDivElement>(null);
  const [{ history, version }] = useState(() => {
    return {
      history: context.getHistory(componentId),
      version: context.versionsMap[componentId]
    }
  })

  const {
    loading,
    versions,
    total,
    hasMore,
    fetchMaterials,
    loadMore,
    refresh,
  } = useVersions({
    pageSize: 20,
    history,
    version,
    componentId
  })

  const handleRollback = useCallback((version: VersionRecord) => {
    const rollback = (context as any).getRollback?.(componentId);
    rollback?.(version.id);
  }, [componentId]);

  return (
    <div className={css.list} id="com-material-list" ref={panelContainer}>
      <InfiniteScroll
        loading={loading}
        scrollableTarget={'com-material-list'}
        dataLength={versions.length}
        hasMore={hasMore}
        loader={
          <p className={css.loading}>
            <Spin />
          </p>
        }
        style={{ paddingTop: 12 }}
        endMessage={<p className={css.noMore}>- 没有更多了 -</p>}
        next={loadMore}
      >
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
          )
        })}
      </InfiniteScroll>
    </div>
  )
}


interface UseVersionsOptions {
  pageSize: number
  history: {
    listVersions: (params: { pageSize: number, pageNum: number }) => Promise<{ total: number; list: VersionRecord[] }>
  }
  version: Version
  componentId: string
}
export function useVersions(options: UseVersionsOptions) {
  const { 
    pageSize,
    history,
    version,
    componentId
  } = options;
  
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [total, setTotal] = useState(version.total);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  // 使用 useRef 存储查询参数
  const queryRef = useRef<Record<string, any>>({});

  // 获取物料列表
  const fetchMaterials = useCallback(async (params: any = {}, reset: boolean = true) => {
    setLoading(true);
    try {
      // 如果是重置，则清空现有数据
      if (reset) {
        setVersions([]);
        setCurrentPage(1);
        queryRef.current = params;
      }

      const requestParams = {
        ...(queryRef.current ?? {}),
        pageNum: reset ? 1 : currentPage,
        pageSize,
        ...params,
      };

      console.log("[requestParams]", requestParams)

      const response = await history.listVersions(requestParams);
      const newVersions = response.list ?? []

      setVersions(prev => {
        const merged = reset ? newVersions : [...prev, ...newVersions]
        // 按 id 去重，保留第一次出现的条目
        const seen = new Set<string>()
        const versions = merged.filter(v => {
          if (seen.has(v.id)) return false
          seen.add(v.id)
          return true
        })
        version.list = versions

        setHasMore(version.list.length < version.total)

        return versions
      });
      // setTotal(response.total);
      // setHasMore(newVersions.length === pageSize);
      

      if (!reset) {
        setCurrentPage(prev => {
          return prev + 1
        });
      }
      
      return response;
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize]);

  // 加载更多
  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    await fetchMaterials({ pageNum: currentPage + 1 }, false);
  }, [fetchMaterials, hasMore, loading, currentPage]);

  // 重置并重新加载
  const refresh = useCallback((params = {}) => {
    return fetchMaterials({ ...(queryRef.current ?? {}), ...params }, true);
  }, [fetchMaterials]);

  useEffect(() => {
    fetchMaterials()

    const off = context.getVersionStateEvents(componentId).on(
      'change',
      (newVersion) => {
        setTotal(version.total)
        setVersions(prev => {
          const index = prev.findIndex((version) => version.id === newVersion.id)
          if (index === -1) {
            return [newVersion, ...prev]
          }

          prev[index] = {
            ...prev[index],
            ...newVersion
          }

          return [...prev]
        });
      },
      false
    );

    return () => {
      off();
    };

  }, [])

  return {
    loading,
    versions,
    total,
    hasMore,
    fetchMaterials,
    loadMore,
    refresh,
  };
}