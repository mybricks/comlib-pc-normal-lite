import React, { useMemo } from 'react';
import Runtime from './runtime';

export default (props: any) => {
  const { env, data } = props;
  const debugTarget = data?.debugTarget;
  const isPageDebug = debugTarget?.type === 'page';

  // 页面调试模式：覆盖 env，让整个组件树以完整 runtime 态运行
  const effectiveEnv = useMemo(() => {
    if (isPageDebug) {
      return {
        ...env,
        edit: undefined,
        runtime: { debug: true },
        // 将目标页索引透传给 createMybricks，用于过滤只渲染该页
        _debugPageIndex: debugTarget.pageIndex,
      };
    }
    return env;
  }, [env, isPageDebug, debugTarget?.pageIndex]);

  // key 变化时 React 会完整卸载再挂载：
  // - 编辑态 ↔ 页面调试态切换时，store/state 完全隔离，互不影响
  // - 不同页面之间切换时同样强制重建，避免上一页状态污染
  const runtimeKey = isPageDebug
    ? `page-debug-${debugTarget.pageIndex}`
    : 'component-edit';

  return <Runtime key={runtimeKey} {...props} env={effectiveEnv} />;
};
