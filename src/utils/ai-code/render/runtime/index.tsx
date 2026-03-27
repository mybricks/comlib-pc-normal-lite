import React, { useEffect, useLayoutEffect, useMemo } from "react";
import { useCssApi } from "./hooks";
import FilesModule from "./FilesModule";
import ErrorBoundary from "./ErrorBoundary";
import { createMyBricks } from "./mybricks";

interface AIJsxRuntimeParams {
  /** 组件ID */
  id: string

  /** 引擎注入env */
  env: {
    canvas: {
      css: {
        set: (id: string, content: string) => void
        remove: (id: string) => void
      }
    }
    runtime: boolean
    _debugTarget?: {
        pageIndex: string;
        style: Record<string, any>
    }
  }

  /** 依赖注入 */
  dependencies: Record<string, any>

  /** 数据源 */
  data: {
    /** 文件列表 */
    files: {
      fileName: string
      content: Record<string, any>
    }[]
  }

  /** 提示 */
  placeholder: React.ReactNode

  /** 日志 */
  logger: any
}

const AIJsxRuntime = (params: AIJsxRuntimeParams) => {
  const {
    id,
    env,
    data,
    dependencies,
    placeholder,
    logger
  } = params
  const cssApi = useCssApi({ id, env })

  const filesModule = useMemo(() => {
    const mybricks = createMyBricks({
      logger,
      env,
      data
    })

    return new FilesModule({
      files: data.files,
      dependencies: Object.assign(dependencies, { mybricks }),
      importCallBack: {
        less({ fileName, content }) {
          cssApi.set({ fileName, content })
        }
      }
    })
  }, [])

  // 入口文件固定写法，直接读取
  const ReactComponent = useMemo(() => {
    return filesModule.getModule('index.jsx')
  }, [])

  if (typeof ReactComponent !== 'function') {
    const CustomView = typeof window !== 'undefined' && (window as any)._renderCompView_;
    if (CustomView) {
      if (typeof CustomView === 'function') {
        return <CustomView />;
      }
      if (React.isValidElement(CustomView)) {
        return CustomView;
      }
    }
    return placeholder;
  }
  
  return (
    <ErrorBoundary data={data}>
      <ReactComponent />
    </ErrorBoundary>
  )
}

export { AIJsxRuntime }
export type { AIJsxRuntimeParams }
