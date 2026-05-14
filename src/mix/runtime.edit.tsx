import React, { useLayoutEffect, useMemo, useState, useRef, useEffect } from 'react';
import Runtime from './runtime';
import context from './context';
import { registerSandbox } from './sandbox';

const dataCompatible = (props) => {
  try {
    const { id, data } = props;
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

    if (!data.version || data.version < 4) {
      data.version = 4
      const readme = data.files.find((file) => file.fileName === "README.md")
      if (readme?.source) {
        context.updateFile(id, { fileName: "README.md", content: decodeURIComponent(readme.source) })
      }

      data.files.forEach((file) => {
        if (/(?<!\.module)\.less$/.test(file.fileName)) {
          file.fileName = file.fileName.replace(/\.less$/, '.module.less')
          if (file.source?.includes('%40import')) {
            // 将 @import 引用的 .less 路径也改为 .module.less
            file.source = encodeURIComponent(
              decodeURIComponent(file.source).replace(/(?<!\.module)\.less(['")])/g, '.module.less$1')
            )
          }
        }
        // jsx → tsx，js → ts（不影响 .json 等其他扩展名）
        if (/\.jsx$/.test(file.fileName)) {
          file.fileName = file.fileName.replace(/\.jsx$/, '.tsx')
        } else if (/\.js$/.test(file.fileName)) {
          file.fileName = file.fileName.replace(/\.js$/, '.ts')
        }

        // 将源码中的 .less 引用（非 .module.less）改为 .module.less
        if (file.source && (file.fileName.endsWith('.tsx') || file.fileName.endsWith('.ts') || file.fileName.endsWith('.jsx') || file.fileName.endsWith('.js'))) {
          let decoded = decodeURIComponent(file.source)
          decoded = decoded.replace(/(?<=from\s+['"][^'"]*?)(?<!\.module)(\.less)(?=['"])/g, '.module.less')
          // 移除 import 语句中依赖路径末尾的 .js 扩展名
          // e.g. import store from "./store.js" → import store from "./store"
          decoded = decoded.replace(
            /(from\s+['"](?:[^'"]*?))\.js(['"])/g,
            '$1$2'
          )
          file.source = encodeURIComponent(decoded)
        }

        context.updateFile(id, { fileName: file.fileName, content: decodeURIComponent(file.source) })
      })
    }
  } catch (e) {
    console.log('[初始化报错]', e)
  }
}

export default (props: any) => {
  const { env, data } = props;

  dataCompatible(props);

  const [debugTarget, setDebugTarget] = useState<any>(null);
  const [fileChangeKey, setFileChangeKey] = useState<number>(0);
  const [render, setRender] = useState(false)

  useLayoutEffect(() => {
    const events = context.getAiComEvents(props.id);
    const cancelListenDebugTarget = events.on('debugTarget', setDebugTarget);
    // [TODO] 这类文件监听后续整理下
    const cancelListenFileChange = events.on('fileChange', (params) => {
      if (params?.filename === "README.md") {
        setFileChangeKey((key) => key + 1)
      }
    });

    // 注册沙箱：将 mix 组件的文件系统和上下文桥接给 plugin-ai 的 CodeAgent
    registerSandbox(props.id).then(() => {
      // console.log('[初始化成功]', {
      //   context,
      //   props
      // })
    }).catch((error) => {
      // console.error('[初始化错误]', error)
    }).finally(() => {
      setRender(true)
    });

    return () => {
      cancelListenDebugTarget();
      cancelListenFileChange();
    }
  }, [])

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

  return render && <Runtime key={runtimeKey} {...props} env={effectiveEnv} />;
};
