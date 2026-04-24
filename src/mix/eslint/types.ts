/**
 * 与 ESLint Linter.LintMessage 兼容的消息格式。
 * verify() 返回此类型数组，供调用方消费，不阻塞编译。
 */
export interface LintMessage {
  /** 规则 ID，例如 'no-console'、'no-window-location' */
  ruleId: string;
  /** 严重程度：1 = warn，2 = error */
  severity: 1 | 2;
  /** 可读的错误描述 */
  message: string;
  /** 1-based 行号 */
  line: number;
  /** 0-based 列号（与 ESLint 原生对齐） */
  column: number;
  endLine?: number;
  endColumn?: number;
  nodeType?: string;
  /** 所属文件名（便于多文件聚合时定位） */
  fileName?: string;
}
