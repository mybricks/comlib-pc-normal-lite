import React, { useCallback } from "react";
import { Console } from "@mybricks/console-feed";
import context from "../../context";
import { LogMessage } from "../../context";
import { useDarkMode } from "../../../utils/hooks";
import * as lazyCss from "./index.lazy.less";
import { getLazyCss } from "../utils/css";
import { ViewCode, AiFix } from '../icons'
import { lowcodeViewEvents } from '../'

const css = getLazyCss(lazyCss)

interface ConsoleLogPanelProps {
  componentId: string;
  logs: LogMessage[];
}

const transformData = (data: any[]) => {
  const splitIndex = data.findIndex((item) => item === '__logger__')

  if (splitIndex !== -1) {
    return {
      logData: data.slice(0, splitIndex),
      actionData: data.slice(splitIndex + 1)
    }
  }

  return {
    logData: data,
    actionData: []
  }
}

export default function ConsoleLogPanel({ componentId, logs }: ConsoleLogPanelProps) {
  const handleClear = useCallback(() => {
    if (componentId) context.clearComLogs();
  }, [componentId]);

  const isDark = useDarkMode();
  const variant = isDark ? 'dark' : 'light';

  return (
    <div className={css['console-container']}>
      <div className={css['console-toolbar']}>
        <button
          className={css['console-clear-btn']}
          onClick={handleClear}
        >
          清空
        </button>
      </div>
      <div className={css['console-feed-wrapper']}>
        <Console
          logs={logs.map((log) => {
            const { _, data, method } = log
            const { logData, actionData } = _ ? { logData: data, actionData: [] } : transformData(log.data)
            return {
              ...log,
              data: logData,
              action: _ ? null : (actionData?.length ? <LogAction method={method} data={logData} action={actionData[0]} componentId={componentId}/> : null)
            }
          })}
          variant={variant}
          styles={{
            BASE_FONT_SIZE: 12,
            BASE_LINE_HEIGHT: 1.4,
          }}
        />
      </div>
    </div>
  );
}

const formatItem = (item: any): string => {
  if (item === null) return 'null';
  if (item === undefined) return 'undefined';
  if (typeof item === 'string') return item;
  if (item instanceof Error) return `${item.name}: ${item.message}${item.stack ? '\n' + item.stack.split("\n").slice(0, 2).join("\n").replace(/_mybricks_ai\//g, '') : ''}`;
  try {
    return JSON.stringify(item, null, 2);
  } catch {
    return String(item);
  }
};

const LogAction = ({ data, method, action, componentId }) => {
  return (
    <div className={css.logActionContainer}>
      {method === 'error' && (
        <div
          data-mybricks-tip="交给AI修复"
          className={css.logActionButton}
          onClick={() => {
            const message = '当前组件运行时，在控制台打印以下错误，分析问题并修复：\n' +
              data.map(formatItem).join(' ');

            (window as any)._sandbox_?.helpers?.sendToAgent?.(componentId, { message });
          }}
        >
          <AiFix size={14}/>
        </div>
      )}
      <div
        data-mybricks-tip="查看代码"
        className={css.logActionButton}
        onClick={() => {
          lowcodeViewEvents.emit('viewCode', {
            fileName: action.path,
            codeLine: [action.start_line, action.end_line]
          });
        }}
      >
        <ViewCode size={14}/>
      </div>
    </div>
  )
}