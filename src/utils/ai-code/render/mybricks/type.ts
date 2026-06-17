export interface CreateMyBricksProps {
  /** 组件ID */
  comId: string
  /** 运行模式标识（对应外层 runtimeMode） */
  runtimeMode?: string
  /** 环境 */
  env: {
    runtime: boolean
    _debugTarget?: {
      pageIndex: string;
      style: Record<string, any>
    }
  }
  /** 日志 */
  logger: any

  /** 数据源 */
  data: any;
}
