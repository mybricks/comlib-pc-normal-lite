export interface SandboxLogEntry {
  timestamp: number;
  comId: string;
  method: string;
  args: unknown[];
}

export class SandboxLogger {
  private entries: SandboxLogEntry[] = [];

  log(comId: string, method: string, ...args: unknown[]): void {
    this.entries.push({ timestamp: Date.now(), comId, method, args });
    if (this.entries.length > 1000) {
      this.entries.splice(0, this.entries.length - 1000);
    }
  }

  /** 入参按引用保存，查询结果为列表副本。 */
  getLogs(filter: { comId?: string; method?: string } = {}): SandboxLogEntry[] {
    return this.entries.filter(entry =>
      (filter.comId === undefined || entry.comId === filter.comId) &&
      (filter.method === undefined || entry.method === filter.method)
    );
  }

  clear(comId?: string): void {
    this.entries = comId === undefined
      ? []
      : this.entries.filter(entry => entry.comId !== comId);
  }
}

declare global {
  interface Window {
    __sandboxLogger__: SandboxLogger;
  }
}

export const sandboxLogger = window.__sandboxLogger__ ?? new SandboxLogger();
window.__sandboxLogger__ = sandboxLogger;
