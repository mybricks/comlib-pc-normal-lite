type Turn = {
  id?: string;
  userText?: string;
  userFormattedText?: string;
  status?: string;
};

type CompletionCallback = (turn: Turn) => void | Promise<void>;

type PendingCallback = {
  complete: CompletionCallback;
};

/**
 * 将由 sandbox 主动下发的业务请求，与 Agent 的生命周期 hook 在内存中关联。
 *
 * 当前 beforeTurn hook 没有暴露 turnId，因此按同一 comId 的 Agent 队列顺序
 * 关联：pending → started → complete。闭包始终留在浏览器内存，既不写入请求
 * 参数，也不写入 TurnRecord。
 */
class AgentTurnLifecycle {
  private pending = new Map<string, PendingCallback[]>();
  private started = new Map<string, PendingCallback[]>();

  register(comId: string, complete: CompletionCallback): void {
    const callbacks = this.pending.get(comId) ?? [];
    callbacks.push({ complete });
    this.pending.set(comId, callbacks);
  }

  onStart(comId: string): void {
    const callbacks = this.pending.get(comId);
    const callback = callbacks?.shift();
    if (!callback) return;

    if (!callbacks?.length) this.pending.delete(comId);
    const started = this.started.get(comId) ?? [];
    started.push(callback);
    this.started.set(comId, started);
  }

  async onComplete(comId: string, turn: Turn): Promise<void> {
    const callbacks = this.started.get(comId);
    const callback = callbacks?.shift();
    if (!callback) return;

    if (!callbacks?.length) this.started.delete(comId);
    await callback.complete(turn);
  }
}

export const agentTurnLifecycle = new AgentTurnLifecycle();
