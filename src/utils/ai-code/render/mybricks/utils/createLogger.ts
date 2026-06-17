import {
  isLoggerMethod,
  mergeLoggerBindings,
  type LoggerBindings,
} from '../../logger';
import { debugLogs } from '../../../../../mix/context/debugLogs';
import type { CreateMyBricksProps } from '../type';

const createLogger = (props: CreateMyBricksProps) => {
  const { comId, runtimeMode } = props;

  const collectDebugLogs = (entry: { type: string; method: string; args: any[]; result?: any; bindings?: Record<string, any> }) => {
    debugLogs.append(comId, { ...entry, timestamp: Date.now(), mode: runtimeMode });
  };
  const createCapturedLogger = (targetLogger: any = {}, bindings: LoggerBindings = {}) => {
    return new Proxy(targetLogger ?? {}, {
      get(target, prop: string | symbol) {
        if (prop === 'child') {
          return (nextBindings?: LoggerBindings | string) => {
            const childBindings = mergeLoggerBindings(bindings, nextBindings);
            const originalChild = typeof target.child === 'function' ? target.child.bind(target) : null;
            const childLogger = originalChild ? originalChild(nextBindings) : {};

            return createCapturedLogger(childLogger, childBindings);
          };
        }

        if (!isLoggerMethod(prop)) {
          return () => {};
        }

        const original = typeof target[prop] === 'function' ? target[prop].bind(target) : (() => {});

        return (...args: any[]) => {
          const result = original(...args);
          collectDebugLogs({ type: 'logger', method: prop, args, bindings, result });
          return result;
        };
      }
    });
  };
}

export default createLogger
