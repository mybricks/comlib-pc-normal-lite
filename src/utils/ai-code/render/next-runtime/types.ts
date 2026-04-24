import type { ErrorInfo, ComponentType, ReactNode } from 'react'

/** 包裹运行时组件的外层组件 */
export type Wrapper = ComponentType<{ children: ReactNode }>

/** 注入的外部依赖库(如 dayjs、antd 等) */
export type Dependencies = Record<string, any>

/** 文件列表 */
export type Files = {
  /** 文件绝对路径 */
  filename: string
  /** 
   * 编译后且经过encodeURIComponent处理的代码子图传
   * 注意：如果是样式文件，需支持JSON.parse解析出cssContent(样式代码字符串)、classMap(key映射，cssmodules)
   */
  compiled: string
  /** 经过encodeURIComponent处理的源代码 */
  source: string
}[]

export class EmptyDataSource {
  constructor() {}
}

export type DataSource = typeof EmptyDataSource

export type Css = {
  /** 注入样式 */
  set(filename: string, css: string): void
  /** 清空样式 */
  remove(): void
}

/** 处于vibe状态 */
export type Vibing = boolean

/** 运行时错误 */
export type OnRuntimeError = (error: Error, errorInfo: ErrorInfo) => void

export type LoadingView = (props: { tip: string, withContainer: boolean }) => JSX.Element

/** 环境变量替换 */
export type Definitions = Record<string, string>
