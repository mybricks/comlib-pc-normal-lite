import React, { useState, useEffect, useCallback, useRef } from "react";
import context from "../../context";
import type { VersionRecord } from "../../context";
import { Version } from "../../context";
import VersionListView from "../../../components/version-list";
import { undoRedoManager } from '../../editors/undoRedo'

export default function ({ render: _render }) {
  // history/version 在 registerSandbox 结束后才就绪；就绪后立刻挂载（不必等用户点「版本」），
  // 才能收到 SPA 还原等外部写入的 notifyVersionsChange。显隐仍由外层 display 控制。
  const [ready, setReady] = useState(
    () => !!(context.history && context.version),
  )

  useEffect(() => {
    if (ready) return
    const timer = window.setInterval(() => {
      if (context.history && context.version) {
        setReady(true)
        window.clearInterval(timer)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [ready])

  if (!ready) return null
  return <VersionPanel2 />
}

function VersionPanel2() {
  const [{ history, version }] = useState(() => {
    return {
      history: context.history,
      version: context.version
    }
  })

  const {
    loading,
    versions,
    hasMore,
    loadMore,
  } = useVersions({
    pageSize: 20,
    history,
    version,
  })
  const [hasBranchHistory, setHasBranchHistory] = useState(() => undoRedoManager.hasBranchHistory())
  const [isVibing, setIsVibing] = useState(false)

  useEffect(() => undoRedoManager.onBranchHistoryChange(setHasBranchHistory), [])
  useEffect(() => context.component?.events.on('vibing', setIsVibing), [])

  const handleRollback = useCallback((version: VersionRecord, latestVersion?: VersionRecord) => {
    if (undoRedoManager.hasBranchHistory() || isVibing || !latestVersion) return

    const rollback = context.rollback;

    undoRedoManager.execute({
      execute() {
        rollback?.(version.id);
      },
      async undo() {
        rollback?.(latestVersion.id);
      },
    })
  }, [isVibing]);

  return (
    <VersionListView
      versions={versions}
      loading={loading}
      hasMore={hasMore}
      loadMore={loadMore}
      scrollableTarget="com-material-list"
      rollbackDisabled={hasBranchHistory || isVibing}
      style={{ paddingTop: 12 }}
      onRollback={(selectedVersion) => handleRollback(selectedVersion, versions[0])}
    />
  )
}


interface UseVersionsOptions {
  pageSize: number
  history: {
    listVersions: (params: { pageSize: number, pageNum: number }) => Promise<{ total: number; list: VersionRecord[] }>
  }
  version: Version
}
export function useVersions(options: UseVersionsOptions) {
  const { 
    pageSize,
    history,
    version,
  } = options;
  
  const [loading, setLoading] = useState(false);
  // 可能已有 SPA/外部写入的乐观版本（如 mhtml 还原的 V0）
  const [versions, setVersions] = useState<VersionRecord[]>(() =>
    Array.isArray(version.list) ? version.list.slice() : [],
  );
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

        // reset 时合并尚未被服务端返回的乐观版本（addVersion 上传大文件可能需十余秒）
        if (reset) {
          const optimistic = [
            ...(Array.isArray(version.list) ? version.list : []),
            ...prev,
          ]
          for (const local of optimistic) {
            if (!local?.id || seen.has(local.id)) continue
            // 仅保留近 2 分钟内的本地乐观项，避免永久脏数据
            if (Date.now() - (local.createdAt || 0) > 2 * 60 * 1000) continue
            seen.add(local.id)
            versions.push(local)
          }
          versions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        }

        version.list = versions

        setHasMore(version.list.length < version.total)

        return versions
      });

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

    const off = context.versionStateEvents.on(
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
