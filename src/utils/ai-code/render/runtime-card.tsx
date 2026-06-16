import React, {FunctionComponent, ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import { debugLogs } from '../../../mix/context/debugLogs'
import ReactDom from 'react-dom';
import * as antd from "antd";
import * as icons from "@ant-design/icons"
import { StyleProvider } from '@ant-design/cssinjs'
import dayjs from "dayjs";
import {copyToClipboard} from './../index'

import css from './runtime-card.less'
import context, { config } from '../../../mix/context';
import NextRuntime from './next-runtime'
import { DataSource } from './mybricks/data-source'
import { replaceToUnderline } from './mybricks/utils'
import { useDependencies } from './useDependencies'
import { createRuntimeMode } from '../runtimeMode'
import AIChatPanel from './ChatPanel';

/** 运行时错误面板（ErrorBoundary 内部使用） */
export const RuntimeErrorView = ({ title = '组件运行时错误', desc = '', errors = [], comId }: { title?: string; desc?: string; errors?: any[]; comId?: string }) => {
  return <RuntimeCardErrorView title={title} desc={desc} errors={errors} comId={comId} />;
};

/** 编译失败错误面板（外层 genAIRuntime 使用） */
export const CompileErrorView = ({ title = '编译失败', desc = '', errors = [], comId }: { title?: string; desc?: string; errors?: any[]; comId?: string }) => {
  return <RuntimeCardErrorView title={title} desc={desc} errors={errors} comId={comId} />;
};

/** 运行时错误面板，由 @error 捕获 */
export const ErrorView = ({ error, comId }) => {
  return <RuntimeCardErrorView title={"组件运行时错误"} desc={error.message} error={error} comId={comId} source="@error" />;
}

/** 统一错误面板基础交互组件：编译失败、generate.error、eval 失败等共用同一套样式 */
export const RuntimeCardErrorView = ({ title = '错误', desc = '', errors = [], comId, source = '', error }: { title?: string; desc?: string; errors?: any[]; comId?: string; source?: string; error?: Error }) => {
  const onRetry = useCallback(() => {
    let message = '';

    if (source === "@error" && error) {
      message = `当前组件运行时出错：${error.message}，以下是错误堆栈信息：\n` + error.stack?.split("\n").slice(0, 2).join("\n")
    } else {
      // 如果有多条错误，组合所有错误信息
      if (errors && errors.length > 0) {
        message = '当前组件出现了以下错误：\n';
        errors.forEach((err, idx) => {
          const fileLabel = err.file ? `[${err.file}] ` : '[运行时] ';
          message += `${idx + 1}. ${fileLabel}${err.message}\n`;
        });
      } else {
        // 没有 errors 数组，使用传入的 title 和 desc
        message = `当前组件出错了，${desc || title || '未知错误'}`;
      } 
    }
    (window as any)._sandbox_?.helpers?.sendToAgent?.(comId, { message });
  }, [comId, desc, error, errors, source, title]);

  return (
    <div className={css.runtimeCardErrorView}>
      <div className={css.runtimeCardError} data-zone-type='ai-fixed'>
        <span className={css.runtimeCardErrorIcon}>!</span>
        <div className={css.runtimeCardErrorTitle}>{title}</div>
        <pre className={css.runtimeCardErrorDesc}>{desc || '未知错误'}</pre>
        {errors && errors.length > 1 && (
          <details className={css.errorDetails}>
            <summary>查看所有错误 ({errors.length})</summary>
            {errors.map((err, idx) => (
              <div key={idx} className={css.errorItem}>
                <strong>{err.file || '运行时'}</strong>: {err.message}
              </div>
            ))}
          </details>
        )}
        {source === "@error" && error && (
          <details className={css.errorDetails}>
            <div className={css.errorItem}>
              {error.stack}
            </div>
          </details>
        )}
        <button data-zone-type='ai-fixed' className={css.runtimeCardErrorRetry} onClick={onRetry}>交给 AI 修复</button>
      </div>
    </div>
  );
};

/** 生成中流式 loading：上下边缘模糊淡出，中间展示文件名与全量内容；error 时展示错误面板 */
const GenerateLoadingView = ({
  fileName = '',
  content = '',
  error = false,
  errorMessage = '',
  comId,
}: { fileName?: string; content?: string; error?: boolean; errorMessage?: string; comId?: string }) => {
  const onRetry = useCallback(() => {
    const message = errorMessage || '未知错误';
    (window as any)._sandbox_?.helpers?.sendToAgent?.(comId, { message });
  }, [comId, errorMessage]);

  return (
    <div className={css.generateRoot}>
      <div className={css.generateContent}>
        {error ? (
          <div className={css.generateError}>
            <span className={css.generateErrorIcon}>!</span>
            <div className={css.generateErrorTitle}>生成失败</div>
            <pre className={css.generateErrorDesc}>{errorMessage || '未知错误'}</pre>
            <button data-zone-type='ai-fixed' className={css.runtimeCardErrorRetry} onClick={onRetry}>交给 AI 修复</button>
          </div>
        ) : (
          <>
            {fileName ? <div className={css.generateFileName}>{fileName}</div> : null}
            <pre className={css.generateCode}>{content || ' '}</pre>
          </>
        )}
      </div>
    </div>
  );
};

const isAgentFile = (fileName = '') => fileName.replace(/^\//, '').startsWith('.agent/');

const IdlePlaceholder = ({title = 'AI 图表', orgName = 'MyBricks', examples = []}: any) => {
  const copy = useCallback((text) => {
    copyToClipboard(text).then((res) => {
      (window as any).antd?.message?.success?.("复制成功") || alert('复制成功')
      // antd?.message
      //   ? antd?.message.success('复制成功')
      //   : alert('复制成功')
    })
  }, [])

  const CopyIcon = useCallback(() => {
    return (
      <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
           width="16" height="16">
        <path
          d="M337.28 138.688a27.968 27.968 0 0 0-27.968 27.968v78.72h377.344c50.816 0 92.032 41.152 92.032 91.968v377.344h78.656a28.032 28.032 0 0 0 27.968-28.032V166.656a28.032 28.032 0 0 0-27.968-27.968H337.28z m441.408 640v78.656c0 50.816-41.216 91.968-92.032 91.968H166.656a92.032 92.032 0 0 1-91.968-91.968V337.28c0-50.816 41.152-92.032 91.968-92.032h78.72V166.656c0-50.816 41.152-91.968 91.968-91.968h520c50.816 0 91.968 41.152 91.968 91.968v520c0 50.816-41.152 92.032-91.968 92.032h-78.72zM166.656 309.312a27.968 27.968 0 0 0-27.968 28.032v520c0 15.424 12.544 27.968 27.968 27.968h520a28.032 28.032 0 0 0 28.032-27.968V337.28a28.032 28.032 0 0 0-28.032-28.032H166.656z"
          fill="currentColor"></path>
      </svg>
    )
  }, [])

  return (
    <div className={css.tip}>
      {/*<div className={css.title}>{title}</div>*/}
      <div className={css.content}>
        欢迎使用 {orgName} {title}，
        <strong>请点击右下角 AI 助手开始对话</strong>
      </div>
      <p>例如：</p>
      {examples.map((example) => {
        return (
          <div
            className={css.example}
            key={example}
            onClick={() => copy(example)}
          >
            {example} <CopyIcon/>
          </div>
        )
      })}
    </div>
  )
}

interface AIRuntimeProps {
  /** 组件名称 */
  title: string,
  /** 组织名 */
  orgName?: string,
  /** 建议的例子 */
  examples: string[],
  /** 组件运行时的依赖 */
  getDependencies?: () => Record<string, any>,
  wrapper?: FunctionComponent<{ children: ReactElement, env: any, canvasContainer: any }>,
  /** logger 对象或 logger 工厂函数（接受组件 id 返回 logger 对象） */
  logger: any | ((id: string) => any);
}

export const genAIRuntime = ({title, orgName, examples, getDependencies, wrapper, logger}: AIRuntimeProps) =>
  ({env, data, id}: any) => {

    const containerRef = useRef<HTMLDivElement>(null);
    const files = Array.isArray(data.files) ? data.files : [];
    const runtimeFiles = files.filter((file: any) => !isAgentFile(file.fileName));
    const activeEnv = env.edit ? 'mock' : (data._activeDebugEnv ?? 'prod');
    const [reload, setReload] = useState(0)
    const [vibing, setVibing] = useState(false);

    const [showChatPanel, setShowChatPanel] = useState(false)

    useLayoutEffect(() => {
      const events = context.component!.events;
      const cancelListenVibing = events.on('vibing', setVibing);

      return () => {
        cancelListenVibing();
      }
    }, [])

    // 计算 runtimeMode：唯一标识当前运行模式（设计态 / runtime_mock / runtime_prod）
    const runtimeMode = createRuntimeMode(id, env.edit, activeEnv);

    // runtimeMode 变化时：写入 data.runtimeMode，并清除该组件同 runtimeMode 的历史日志
    useEffect(() => {
      data.runtimeMode = runtimeMode;
      debugLogs.clearByMode(id, runtimeMode);
    }, [runtimeMode]);

    useEffect(() => {
      // 如果宿主应用在组件初始化前通过 window.__vibePendingMessage__ 预置了消息，
      // 则在 StartView 挂载后立即触发发送，实现自动开始对话的效果。
      let pendingMessage = (window as any).__vibePendingMessage__;
      (window as any).__vibePendingMessage__ = null;

      // 如果 URL 参数有 id，并且 localStorage 里 mybricks_ai_pending_msg_${urlId} 有值，
      // 解析后若包含 message 字段，则将解析出的整个对象作为 pendingMessage 发送。
      if (!pendingMessage) {
        try {
          const urlId = new URLSearchParams(location.search).get('id');
          if (urlId) {
            const stored = localStorage.getItem(`mybricks_ai_pending_msg_${urlId}`);
            if (stored) {
              const parsed = JSON.parse(stored);
              if (parsed && parsed.message) {
                pendingMessage = parsed;
                localStorage.removeItem(`mybricks_ai_pending_msg_${urlId}`);
              }
            }
          }
        } catch (_) {}
      }

      if (pendingMessage) {
        setTimeout(() => {
          (window as any)._sandbox_?.helpers?.sendToAgent?.(id, pendingMessage);
        }, 500);
      }
    }, []);

    /**
     * 【重要】errorInfo 只响应 compile 错误（type !== 'runtime'），用于阻断渲染并展示编译失败面板。
     * runtime 错误由 ErrorBoundary 在内部捕获并渲染 RuntimeErrorView，不在此处处理。
     */
    const errorInfo = useMemo(() => {
      if (vibing) {
        return
      }
      const compileErrors = (Array.isArray(data._errors) ? data._errors : []).filter((error) => !isAgentFile(error?.file))

      if (compileErrors.length > 0) {
        const firstError = compileErrors[0];
        const fileLabel = firstError.file ? ` (${firstError.file})` : '';
        return {
          title: '编译失败' + fileLabel,
          desc: firstError.message,
          errors: compileErrors,
        };
      }
    }, [data._errors, vibing])

    const Wrapper = useMemo(() => {
      let comp = ({children, env, canvasContainer}) => <>{children}</>
      if (wrapper) {
        // @ts-ignore
        comp = wrapper;
      }
      return comp
    }, [wrapper])

    const canvasContainer = useMemo(() => {
      return document?.querySelector('#_mybricks-geo-webview_')?.shadowRoot || null;
    }, [])

    const dependencies = useDependencies({
      id,
      env,
      data,
      activeEnv,
      runtimeMode,
      logger,
      reload,
      dependencies: {
        'dayjs': dayjs,
        ...(getDependencies?.() ?? {}),
        'react': React,
        'react-dom': ReactDom,
        '@ant-design/icons': icons,
      },
      DataSource
    })

    const shouldRenderSender = !!(window as any)._sandbox_?.helpers?.renders?.renderStartView;

    const renderSender = useMemo(() => {
      if ((window as any)._sandbox_?.helpers?.renders?.renderStartView) {
        return (
          <div className={css.tip}>
            {(window as any)._sandbox_.helpers.renders.renderStartView({ comId: id })}
          </div>
        )
      }
    }, [shouldRenderSender])

    const LoadingView = useMemo(() => {
      const LoadingView = (window as any)._sandbox_.helpers.renders.renderLoadingView || (({ tip }) => tip)
      const { width: canvasWidth = 1200, height: canvasHeight = 900 } = window._sandbox_.config.componentRuntime?.canvas || {}

      return ({ tip, withContainer }) => {
        if (withContainer) {
          return (
            <div
              className={css.tip}
              style={{
                width: canvasWidth,
                height: canvasHeight,
                minWidth: canvasWidth,
                minHeight: canvasHeight
              }}>
              <LoadingView tip={tip}/>
            </div>
          )
        }
        return <LoadingView tip={tip}/>
      }
    }, [])

    // 1. loading：生成中流式界面（含 generate.error 时同风格错误面板）
    // 2. document：需求文档展示（或旧 loading 态），有 document 且尚未有编译代码时
    // 3. error：Less/Babel 编译失败或 generate 的 error，统一错误样式
    // 4. runtime：编译成功，渲染组件
    // 5. placeholder：等待中，展示提示词
    const innerContent = (() => {
      if (data.generate) {
        return (
          <GenerateLoadingView
            fileName={data.generateFileName ?? ''}
            content={data.generateContent ?? ''}
            error={!!data.generateError}
            errorMessage={data.generateErrorMessage ?? ''}
            comId={id}
          />
        );
      }
      if ((data.document && !files.length) || data.loading) {
        return (
          <div className={css.documentCard}>
            <div className={css.documentContent}>{data.document}</div>
            {data.loading && (
              <div className={css.loadingMask}>
                <antd.Spin />
              </div>
            )}
          </div>
        );
      }

      if (errorInfo) {
        return <CompileErrorView title={errorInfo.title} desc={errorInfo.desc} errors={errorInfo.errors} comId={id} />;
      }

      if (data.files.length) {
        const nextRuntime = (
          <NextRuntime
            key={activeEnv + "_" + reload}
            wrapper={({ children }) => {
              return (
                <StyleProvider hashPriority='low'>
                  {children}
                </StyleProvider>
              )
            }}
            dependencies={dependencies}
            css={{
              set(filename, css) {
                const STYLE_REPLACE_ID = '__mybricks_ai_module_id__';
                // 替换编译时注入的值，使用where防止提升权重
                const myContent = css.replaceAll(`.${STYLE_REPLACE_ID}`, `:where(.${id})`)
                  .replace(/:where\(\.[^)]+\)\s*(:root\b)/g, ':host') // 引擎shadowdom内oot替换为:host
                // 组件id + 文件路径，保证唯一性
                env.canvas.css.set(`${id}_${filename}`.replace(/\./g, '__').replace(/\//g, '_'), myContent)
              },
              remove() {
                env.canvas.css.remove(id)
              }
            }}
            vibing={vibing}
            onMount={({ fileSystem }) => {
              context.fileSystem = fileSystem
              fileSystem.init(runtimeFiles.map((file) => {
                return {
                  ...file,
                  filename: file.fileName
                }
              }))

              if (window._sandbox_.config.componentRuntime?.chat) {
                setShowChatPanel(true)
              }
            }}
            onRuntimeError={(error) => {
              context.component!.events.emit('runtimeError', error)
            }}
            ErrorView={({ error }) => {
              return <ErrorView error={error} comId={id} />
            }}
            entryFile={config.getEntryFile()}
            onFileChange={({ filename, type }) => {
              if ((filename.startsWith('setup.') || filename.startsWith('frontend/setup.')) && type === 'update') {
                // [TODO]
                setReload((reload) => reload + 1)
              }
            }}
            LoadingView={LoadingView}
            definitions={{
              'process.env.POPUP_VISIBLE': JSON.stringify(env.runtime ? false : true),
              'process.env.POPUP_NODE': '_mybricks_props.popupNode',
              'process.env.MODE': JSON.stringify(env.runtime ? 'runtime' : 'design'),
              'process.env.DEBUG_TARGET': JSON.stringify(env._debugTarget ?? {}),
              'process.env.db.user': JSON.stringify(''),
              'process.env.db.password': JSON.stringify(''),
              'process.env.db.host': JSON.stringify(''),
              'process.env.db.port': JSON.stringify(''),
              'process.env.db.database': JSON.stringify(''),
              'process.env.db': '({})',
              'process.env': '({})'
            }}
          />
        )

        return (
          <div className={showChatPanel ? css.withAIChatPanel : undefined}>
            {showChatPanel && (
              <AIChatPanel
                key={id}
                getCardsGroups={() => {
                  const cards: any = []
                  Object.entries(dependencies.mybricks._configCard).forEach(([filename, card]: any) => {
                    // const { title, props, description } = config
                    cards.push({
                      get name() {
                        return card.config.title
                      },
                      get title() {
                        return card.config.title
                      },
                      get description() {
                        return card.config.description
                      },
                      get props() {
                        return card.config.props
                      },
                      get render() {
                        return card.render
                      },
                      get apis() {
                        return card.config.apis
                      }
                    })
                  })
                  return [{
                    title: '通用分组',
                    description: '通用卡片',
                    cards,
                  }]
                }}
              />
            )}
            {nextRuntime}
          </div>
        )
      }

      return shouldRenderSender ? renderSender : <IdlePlaceholder title={title} orgName={orgName} examples={examples} />;
    })();

    return (
      <div ref={containerRef} className={css.container} style={{ display: 'contents' }}>
        <Wrapper env={env} canvasContainer={canvasContainer}>
          {innerContent}
        </Wrapper>
      </div>
    );
}

export default genAIRuntime;
