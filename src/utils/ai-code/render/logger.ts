export type LoggerMethod = 'log' | 'info' | 'warn' | 'error';
export type LoggerBindings = Record<string, any>;

const LOG_METHODS = new Set(['log', 'info', 'warn', 'error']);

export function isLoggerMethod(method: string | symbol): method is LoggerMethod {
  return typeof method === 'string' && LOG_METHODS.has(method);
}

export function normalizeLoggerBindings(bindings?: LoggerBindings | string | null): LoggerBindings {
  if (!bindings) {
    return {};
  }

  if (typeof bindings === 'string') {
    return { scope: bindings };
  }

  if (typeof bindings === 'object' && !Array.isArray(bindings)) {
    return bindings;
  }

  return {};
}

export function mergeLoggerBindings(base: LoggerBindings, next?: LoggerBindings | string | null): LoggerBindings {
  return {
    ...base,
    ...normalizeLoggerBindings(next),
  };
}
