/**
 * 三方库校验框架共享类型定义
 *
 * 设计目标：
 *   - 轻量层（validate）：纯字符串/正则，同步，零依赖，适合快速规则检查
 *   - AST 层（validatePlugin）：标准 Babel plugin factory，复用 window.Babel 的同一次
 *     parse/transform，精确且零额外开销；由 transformTsx 统一注入 plugins 数组
 *   - 多文件上下文（ValidateContext）：通过 ctx.relatedFiles 传入相关文件内容，
 *     供 AST plugin 在需要时做简单跨文件关联分析
 */

// ── 多文件上下文 ─────────────────────────────────────────────────────────────

/**
 * 校验时的文件上下文，在 Babel plugin（validatePlugin）中通过闭包访问。
 * - fileName：当前正在编译的文件名，如 'runtime.jsx' / 'store.js'
 * - relatedFiles：其他相关文件的原始内容，供跨文件简单关联分析
 *   key 为文件名，value 为原始字符串（未 encode）
 */
export interface ValidateContext {
  fileName: string;
  relatedFiles?: Record<string, string>;
}

// ── 错误类型 ─────────────────────────────────────────────────────────────────

/** 校验错误条目 */
export interface ValidationError {
  /** 错误类型 */
  type: 'unknown-export' | 'invalid-usage';
  /** 人类可读的错误描述 */
  message: string;
  /** 可选的修正建议，可拼入反馈给用户/AI 的提示里 */
  fix?: string;
}

// ── 校验器接口 ───────────────────────────────────────────────────────────────

/**
 * 单个三方库校验器接口。
 *
 * 每个库的 validator.ts 导出一个实现此接口的对象。
 * 两种校验模式可按需实现，不强制全部实现：
 *
 * 1. validate()         轻量字符串层，同步，在 Babel 编译前运行
 * 2. validatePlugin()   AST 层，返回标准 Babel plugin factory，
 *                       注入 transformTsx 的 plugins 数组，
 *                       与 babelPlugin 共享同一次 parse，零额外开销
 */
export interface LibraryValidator {
  /** 与 import source 字符串完全匹配，如 '@ant-design/icons' */
  libraryName: string;

  /**
   * 【轻量层】纯字符串/正则校验，同步执行，在 Babel 编译之前运行。
   * 适合快速白名单检查、明显的拼写错误检测等不需要 AST 精度的场景。
   *
   * @returns 错误列表，无错误返回 []
   */
  validate?(code: string, ctx?: ValidateContext): ValidationError[];

  /**
   * 【AST 层】返回一个标准 Babel plugin factory（即接受 babel 参数、返回 { visitor } 的函数）。
   * 该 plugin 会被注入到 transformTsx 的 plugins 数组中，
   * 和 babelPlugin 共享同一次 Babel parse/transform，精确且零额外开销。
   *
   * 在 plugin 内部可通过 ctx 访问多文件上下文（当前文件名、相关文件内容等）。
   * 错误处理：使用 path.buildCodeFrameError(msg) 抛出，与编译错误体验完全一致。
   *
   * @param ctx 文件上下文，含 fileName 和可选的 relatedFiles
   * @returns 标准 Babel plugin factory：(babel) => { visitor: { ... } }
   */
  validatePlugin?(ctx: ValidateContext): (babel: any) => { visitor: Record<string, any> };
}

// ── validateCode 返回值 ───────────────────────────────────────────────────────

/** validateCode（字符串层）的返回值 */
export interface CodeValidationResult {
  ok: boolean;
  errors: ValidationError[];
  /** 格式化后的错误信息字符串，可直接用于展示或注入 AI 上下文 */
  message: string;
}
