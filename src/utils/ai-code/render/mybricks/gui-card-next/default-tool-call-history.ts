type CompactRecord = any
type TurnRecord = any
type ToolCallRecord = any
type VersionRecord = any
type VersionFile = any
type History = any

/**
 * DefaultToolCallHistory
 *
 * 一个轻量的 History 实现，专门用于让 Agent 在首次加载时内置一条"工具调用"历史记录。
 *
 * 使用场景：
 *   当你希望 Agent 初始化后对话上下文里已存在一次工具调用（例如用于演示、测试
 *   或固定的初始化引导），可以直接把此实例作为 `history` 传给 Agent。
 *
 * 行为：
 *   - `load`：首次调用时返回一条内置的工具调用 TurnRecord；后续调用返回空数组
 *     （Agent 在 append / import 之后会持有自己的 turns，不需要再次从此处读取）。
 *   - 其余所有方法均为空函数（no-op），不做任何持久化。
 *
 * @example
 * ```ts
 * import { Agent } from "@mybricks/agent";
 * import { DefaultToolCallHistory } from "@mybricks/agent/history/default-tool-call-history";
 *
 * const agent = new Agent({
 *   history: new DefaultToolCallHistory({
 *     toolName: "my_tool",
 *     toolArgs: { query: "hello" },
 *     toolResult: "Hello, world!",
 *   }),
 *   key: "demo-session",
 *   // ...其他选项
 * });
 * ```
 */

export interface DefaultToolCallHistoryOptions {
  /** 工具名称，默认 "initialize" */
  toolName?: string;
  /** 工具标题（UI 展示用），默认与 toolName 相同 */
  toolTitle?: string;
  /** 工具调用参数，默认 {} */
  toolArgs?: Record<string, unknown>;
  /** 工具调用返回结果文本，默认 "Tool executed successfully." */
  toolResult?: any;
  /** 内置 turn 的用户提示文本，默认 "" */
  userText?: string;
}

export class DefaultToolCallHistory implements History {
  private readonly options: Required<DefaultToolCallHistoryOptions>;
  private loaded = false;

  constructor(options: DefaultToolCallHistoryOptions = {}) {
    this.options = {
      toolName: options.toolName ?? "initialize",
      toolTitle: options.toolTitle ?? (options.toolName ?? "initialize"),
      toolArgs: options.toolArgs ?? {},
      toolResult: options.toolResult ?? "Tool executed successfully.",
      userText: options.userText ?? "",
    };
  }

  // ── 对话记录 ──────────────────────────────────────────────────────────────

  /**
   * 首次调用时返回包含一条工具调用的 TurnRecord[]；
   * 后续调用返回空数组（保证幂等，不重复注入）。
   */
  async load(_key: string): Promise<TurnRecord[]> {
    if (this.loaded) return [];
    this.loaded = true;

    const now = Date.now();

    const toolCall: ToolCallRecord = {
      callId: `default-tool-call-${now}`,
      name: this.options.toolName,
      title: this.options.toolTitle,
      args: this.options.toolArgs,
      result: this.options.toolResult,
      status: "success",
      execStartTime: now,
      execEndTime: now,
    };

    const turn: TurnRecord = {
      id: `default-turn-${now}`,
      startTime: now,
      endTime: now,
      userText: this.options.userText,
      userAttachments: [],
      iterations: [
        {
          content: "",
          toolCalls: [toolCall],
          startTime: now,
          responseTime: now,
          endTime: now,
        },
      ],
      status: "success",
    };

    return [turn];
  }

  async append(_key: string, _record: TurnRecord): Promise<void> {
    // no-op
  }

  async update(
    _key: string,
    _turnId: string,
    _patch: Partial<TurnRecord>
  ): Promise<void> {
    // no-op
  }

  async clear(_key: string): Promise<void> {
    // no-op
  }

  async import(_key: string, _turns: TurnRecord[]): Promise<void> {
    // no-op
  }

  async loadCompact(_key: string): Promise<CompactRecord | null> {
    return null;
  }

  async saveCompact(_key: string, _record: CompactRecord): Promise<void> {
    // no-op
  }

  // ── 版本快照 ──────────────────────────────────────────────────────────────

  async listVersions(
    _key: string,
    _params?: { pageSize?: number; pageNum?: number }
  ): Promise<{ total: number; list: VersionRecord[] }> {
    return { total: 0, list: [] };
  }

  async addVersion(
    _key: string,
    _record: VersionRecord,
    _files: VersionFile[]
  ): Promise<void> {
    // no-op
  }

  async getVersionFiles(_versionId: string): Promise<VersionFile[]> {
    return [];
  }

  async getVersion(_versionId: string): Promise<VersionRecord | null> {
    return null;
  }

  async updateVersion(
    _versionId: string,
    _patch: Partial<Pick<VersionRecord, "summary">> & { files?: VersionFile[] }
  ): Promise<void> {
    // no-op
  }
}
