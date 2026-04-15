import React, { useLayoutEffect, useMemo, useState, useRef, useEffect } from 'react';
import Runtime from './runtime';
import context from './context';

const dataCompatible = (data) => {
  if (!data._errors) {
    data._errors = [];
  }
  if (!data.themes) {
    data.themes = {
      activeThemeId: 'theme-1',
      themes: [
        {
          id: 'theme-1',
          name: '默认主题',
          vars: []
        }
      ]
    };
  } else if (Array.isArray(data.themes)) {
    data.themes = {
      activeThemeId: 'theme-1',
      themes: [
        {
          id: 'theme-1',
          name: '默认主题',
          vars: data.themes
        }
      ]
    }
  }
}

export default (props: any) => {
  const { env, data } = props;

  dataCompatible(data);

  const [debugTarget, setDebugTarget] = useState<any>(null);
  const [fileChangeKey, setFileChangeKey] = useState<number>(0);

  useLayoutEffect(() => {
    const events = context.getAiComEvents(props.id);
    const cancelListenDebugTarget = events.on('debugTarget', setDebugTarget);
    // [TODO] 这类文件监听后续整理下
    const cancelListenFileChange = events.on('fileChange', (params) => {
      if (params?.filename === "README.md") {
        setFileChangeKey((key) => key + 1)
      }
    });
    return () => {
      cancelListenDebugTarget();
      cancelListenFileChange();
    }
  }, [])

    // // 用稳定的 key 字符串表示 files 快照，用于监听变化
    // const filesKey = data.files.map((f) => `${f.fileName}:${f.source}`).join('|');
  
    // // 监听 files 变化：刷新当前选中文件内容 / 处理文件被删除的情况
    // const prevFilesKeyRef = useRef<string>('');
    // useEffect(() => {
    //   if (prevFilesKeyRef.current === filesKey) return;
    //   prevFilesKeyRef.current = filesKey;

    //   setFileChangeKey((c) => c + 1);
    // }, [filesKey]);

  // const debugTarget = data?.debugTarget;
  const isPageDebug = debugTarget?.type === 'page';

  // 页面调试模式：覆盖 env，让整个组件树以完整 runtime 态运行
  const effectiveEnv = useMemo(() => {
    if (isPageDebug) {
      return {
        ...env,
        edit: undefined,
        runtime: { debug: true },
        // 将目标页索引透传给 createMybricks，用于过滤只渲染该页
        _debugTarget: debugTarget,
      };
    }
    return env;
  }, [env, isPageDebug, debugTarget?.pageIndex]);

  // key 变化时 React 会完整卸载再挂载：
  // - 编辑态 ↔ 页面运行态切换时，store/state 完全隔离，互不影响
  // - 不同页面之间切换时同样强制重建，避免上一页状态污染
  const runtimeKey = `${isPageDebug
    ? `page-debug-${debugTarget.pageIndex}`
    : 'component-edit'}` + fileChangeKey;
// key={runtimeKey} 

  return <Runtime key={runtimeKey} {...props} env={effectiveEnv} />;
};
