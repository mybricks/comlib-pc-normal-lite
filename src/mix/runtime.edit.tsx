import React, { useLayoutEffect, useMemo, useState, useRef, useEffect } from 'react';
import Runtime from './runtime';
import context, { config } from './context';
import { registerSandbox } from './sandbox';
import { parseFrameSize } from '../utils/ai-code/render/mybricks/utils'

const dataCompatible = (props) => {
  try {
    const { id, data } = props;

    const mode = config.getFrontendMode()

    if (mode === 'gui_card' && !data.gui_card) {
      const modeConfig = config.getFrontendModeConfig()
      data.gui_card = Object.assign({
        assistantTitle: '智能助手',
        icon: 'https://f2.eckwai.com/kos/nlav12333/aicode/logo/newlogo.png',
        title: '欢迎使用',
        titleHighlight: 'AI 助手',
        subtitle: '你可以向我提问',
        colorPrimary: '#FA6400'
      }, modeConfig)
    }

    if (!data._componentRuntime) {
      data._componentRuntime = {}
    }
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

    const readme = data.files.find((file) => file.fileName === "README.md")
    if (readme) {
      // 从 data.files 中移除 README.md（已同步到 context，无需保留在文件列表中）
      data.files = data.files.filter((file) => file.fileName !== "README.md");
    }

    const version = config.getVersion()
    if (!data.version || data.version < 43 || (typeof version === 'number' && (typeof data._componentRuntime.version !== 'number' || data._componentRuntime.version < version))) {
      data.version = 43
      data._componentRuntime.version = version
      console.log('[com:update]', data)
      console.log('mode', mode)
      // 去除重复文件（以 fileName 为唯一键，保留最后出现的条目）
      const fileMap = new Map<string, any>();
      data.files.forEach((file) => {
        fileMap.set(file.fileName, file);
      });
      data.files = Array.from(fileMap.values());

      if (data.files.length && mode === 'prototype') {
        if (!fileMap.has('app.config.ts')) {
          let maxWidth = 0
          data.files.forEach((file) => {
            if (file.source && file.fileName.endsWith('.less')) {
              const lessCode = typeof file?.source === 'string' ? decodeURIComponent(file.source) : ""
              const { width } = parseFrameSize(lessCode);
              if (width) {
                const numberWidth = parseInt(width)
                if (numberWidth > maxWidth) {
                  maxWidth = numberWidth
                }
              }
            }
          })

          if (!maxWidth) {
            maxWidth = 1440
          }

          const id = maxWidth > 414 ? 'pc': 'mobile'
          const label = maxWidth > 414 ? 'PC端' : '移动端'

          context.updateFile({ fileName: 'app.config.ts', content: `export default defineAppConfig({
  viewports: [
    {
      id: '${id}',
      label: '${label}',
      width: ${maxWidth},
    },
  ],
  breakpoints: [],
});
` })

          data.files.unshift({
            fileName: "app.config.ts",
            content: `export default {
  "name": "项目名称",
  "title": "页面标题",
  "width": ${maxWidth}
}`
          })
        }
      }

      const entryJsxFile = data.files.find((file) => file.fileName === "index.jsx")

      if (entryJsxFile) {
        // 老项目，jsx 转 tsx
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
            // 移除 import 语句中依赖路径末尾的 .js / .jsx 扩展名
            // e.g. import store from "./store.js" → import store from "./store"
            // e.g. import Comp from "./Comp.jsx" → import Comp from "./Comp"
            decoded = decoded.replace(
              /(from\s+['"](?:[^'"]*?))\.jsx?(['"])/g,
              '$1$2'
            )
            // 将裸 import .less 语句（无 from）转换为 .module.less
            // e.g. import "./index.less" → import "./index.module.less"
            decoded = decoded.replace(
              /^(import\s+['"](?:[^'"]*?)(?<!\.module))(\.less)(['"];?)$/gm,
              '$1.module.less$3'
            )
            file.source = encodeURIComponent(decoded)
          }


          context.updateFile({ fileName: file.fileName, content: decodeURIComponent(file.source) })
        })
      } else if (mode === 'react-native') {
        data.files.forEach((file) => {
          context.updateFile({ fileName: file.fileName, content: decodeURIComponent(file.source) })
        })
      } else {
        data.files.forEach((file) => {
          if (file.fileName.endsWith('.less')) {
            context.updateFile({ fileName: file.fileName, content: decodeURIComponent(file.source) })
          }
        })
      }
    }
  } catch (e) {
    console.log('[初始化报错]', e)
  }
}

export default (props: any) => {
  if (window.MYBRICKS_LOCAL_IFRAME) {
    return (
      <iframe
        src={'/__local/lingchuang'}
        style={{ border: 'none', width: '100vw', height: '100vh' }}
        onLoad={(ref) => {
          props.onIframeLoad(ref.target.contentDocument)
        }}
      />
    )
  }

  const { env, data } = props;

  dataCompatible(props);

  const [debugTarget, setDebugTarget] = useState<any>(null);
  const [fileChangeKey, setFileChangeKey] = useState<number>(0);
  const [render, setRender] = useState(false)
  const [sandboxError, setSandboxError] = useState<string | null>(null)

  useLayoutEffect(() => {
    ;(window as any).__MB_REGISTER_ICONS__ = context.registerIcons.bind(context)
    const events = context.component!.events
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
      setRender(true)
    }).catch((error) => {
      console.error('[初始化错误]', error)
      setSandboxError('工程加载失败，请刷新页面后重试')
    });

    return () => {
      cancelListenDebugTarget();
      cancelListenFileChange();
      delete (window as any).__MB_REGISTER_ICONS__
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

  if (sandboxError) {
    return (
      <div
        role="alert"
        style={{ padding: 16, color: '#ff4d4f' }}
      >
        {sandboxError}
      </div>
    )
  }

  return render && <Runtime key={runtimeKey} {...props} env={effectiveEnv} />;
};
