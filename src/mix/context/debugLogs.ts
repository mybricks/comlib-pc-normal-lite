type LogEntry = { type: string; method: string; args: any[]; result?: any; timestamp: number; mode?: string };

const logsMap = new Map<string, LogEntry[]>();

export const debugLogs = {
  append(comId: string, entry: LogEntry) {
    if (!logsMap.has(comId)) {
      logsMap.set(comId, []);
    }
    logsMap.get(comId)!.push(entry);
  },

  clear(comId: string) {
    logsMap.set(comId, []);
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
  },
};
