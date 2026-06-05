export type LogEntry = {
  id: string;
  type: string;
  method: string;
  args: any[];
  result?: any;
  timestamp: number;
  mode?: string;
  bindings?: Record<string, any>;
};

const logsMap = new Map<string, LogEntry[]>();
const countersMap = new Map<string, number>();

export const debugLogs = {
  append(comId: string, entry: Omit<LogEntry, 'id'> & { id?: string }) {
    if (!logsMap.has(comId)) {
      logsMap.set(comId, []);
    }

    const nextCounter = (countersMap.get(comId) ?? 0) + 1;
    countersMap.set(comId, nextCounter);
    logsMap.get(comId)!.push({
      ...entry,
      id: entry.id ?? `l${nextCounter.toString(36)}`,
    });
  },

  clear(comId: string) {
    logsMap.set(comId, []);
    countersMap.set(comId, 0);
  },

  /** 清除指定组件下属于某个 runtimeMode 的所有日志（不影响其他模式的日志） */
  clearByMode(comId: string, mode: string) {
    const logs = logsMap.get(comId);
    if (!logs) return;
    logsMap.set(comId, logs.filter((entry) => entry.mode !== mode));
  },

  get(comId: string): LogEntry[] {
    return logsMap.get(comId) ?? [];
  },

  delete(comId: string) {
    logsMap.delete(comId);
    countersMap.delete(comId);
  },
};
