import React, {FunctionComponent, ReactElement, useCallback, useMemo} from 'react'
import * as antd from "antd";
import * as icons from "@ant-design/icons"
import {AIJsxRuntime} from './index'
import {copyToClipboard} from './../index'

import css from './runtime-card.less'

/** 统一错误面板：编译失败、generate.error、eval 失败等共用同一套样式 */
export const RuntimeCardErrorView = ({ title = '错误', desc = '' }: { title?: string; desc?: string }) => {
  const onRetry = useCallback(() => {
    const message = desc || title || '未知错误';
    setTimeout(() => {
      if ((window as any)._sendToFocusVibeAgent_) {
        (window as any)._sendToFocusVibeAgent_({ message: `当前组件出错了，${message}` });
      }
    }, 500)
  }, [title, desc]);

  return (
    <div className={css.runtimeCardErrorView}>
      <div className={css.runtimeCardError}>
        <span className={css.runtimeCardErrorIcon}>!</span>
        <div className={css.runtimeCardErrorTitle}>{title}</div>
        <pre className={css.runtimeCardErrorDesc}>{desc || '未知错误'}</pre>
        <button className={css.runtimeCardErrorRetry} onClick={onRetry}>交给 AI 修复</button>
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
}: { fileName?: string; content?: string; error?: boolean; errorMessage?: string }) => {
  const onRetry = useCallback(() => {
    const message = errorMessage || '未知错误';
    if ((window as any)._sendToFocusVibeAgent_) {
      (window as any)._sendToFocusVibeAgent_({ message });
    }
  }, [errorMessage]);

  return (
    <div className={css.generateRoot}>
      <div className={css.generateContent}>
        {error ? (
          <div className={css.generateError}>
            <span className={css.generateErrorIcon}>!</span>
            <div className={css.generateErrorTitle}>生成失败</div>
            <pre className={css.generateErrorDesc}>{errorMessage || '未知错误'}</pre>
            <button className={css.runtimeCardErrorRetry} onClick={onRetry}>交给 AI 修复</button>
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
  dependencies?: Record<string, any>,
  wrapper?: FunctionComponent<{ children: ReactElement, env: any, canvasContainer: any }>,
}

// const mybricks = {
//   Container: ({ children, ...props}) => {
//     return <div {...props}>{children}</div>
//   }
// }

export const genAIRuntime = ({title, orgName, examples, dependencies, wrapper}: AIRuntimeProps) =>
  ({env, data, inputs, outputs, slots, logger, id}: RuntimeParams<any>) => {
    // useMemo(() => {
    //   if (env.edit) {
    //     data._editors = void 0
    //   }
    // }, [])

    const errorInfo = useMemo(() => {
      if (!!data._jsxErr) {
        return {
          title: 'JSX 编译失败',
          desc: data._jsxErr,
        }
      }

      if (!!data._cssErr) {
        return {
          title: 'Less 编译失败',
          desc: data._cssErr,
        }
      }
    }, [data._jsxErr, data._cssErr])

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

    const hasCompiledCode = data.runtimeJsxCompiled && String(data.runtimeJsxCompiled).trim() !== ''

    // 1. loading：生成中流式界面（含 generate.error 时同风格错误面板）
    if (data.generate) {
      return (
        <Wrapper env={env} canvasContainer={canvasContainer}>
          <GenerateLoadingView
            fileName={data.generateFileName ?? ''}
            content={data.generateContent ?? ''}
            error={!!data.generateError}
            errorMessage={data.generateErrorMessage ?? ''}
          />
        </Wrapper>
      );
    }

    // 2. document：需求文档展示（或旧 loading 态），有 document 且尚未有编译代码时
    if ((data.document && !data.runtimeJsxCompiled) || data.loading) {
      return (
        <Wrapper env={env} canvasContainer={canvasContainer}>
          <div className={css.documentCard}>
            <div className={css.documentContent}>{data.document}</div>
            {data.loading && (
              <div className={css.loadingMask}>
                <antd.Spin />
              </div>
            )}
          </div>
        </Wrapper>
      );
    }

    // 3. error：Less/Babel 编译失败或 generate 的 error，统一错误样式
    if (errorInfo) {
      return (
        <Wrapper env={env} canvasContainer={canvasContainer}>
          <RuntimeCardErrorView title={errorInfo.title} desc={errorInfo.desc} />
        </Wrapper>
      );
    }

    // 4. runtime：编译成功，渲染组件
    if (hasCompiledCode) {
      return (
        <Wrapper env={env} canvasContainer={canvasContainer}>
          <AIJsxRuntime
            env={env}
            logger={logger}
            id={id}
            styleCode={data.styleCompiled}
            renderCode={data.runtimeJsxCompiled}
            data={data}
            inputs={inputs}
            outputs={outputs}
            placeholder={<IdlePlaceholder title={title} orgName={orgName} examples={examples}/>}
            renderError={(props) => <RuntimeCardErrorView title={props.title} desc={props.desc} />}
            dependencies={{
              ...(dependencies ?? {}),
              'react': React,
              '@ant-design/icons': icons,
            }}
            inMybricksGeoWebview={!!canvasContainer}
          />
        </Wrapper>
      );
    }

    // 5. placeholder：等待中，展示提示词
    return (
      <Wrapper env={env} canvasContainer={canvasContainer}>
        <IdlePlaceholder title={title} orgName={orgName} examples={examples} />
      </Wrapper>
    );
  }
