type LogEntry = { type: string; method: string; args: any[]; result?: any; timestamp: number };

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

  get(comId: string): LogEntry[] {
    return logsMap.get(comId) ?? [];
  },

  delete(comId: string) {
    logsMap.delete(comId);
  },
};
