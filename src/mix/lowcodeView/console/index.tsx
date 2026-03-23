import React, { useCallback } from "react";
import { Console } from "console-feed";
import context from "../../context";
import { LogMessage } from "../../context";
import { useDarkMode } from "../../../utils/hooks";
import lazyCss from "./index.lazy.less";

const css = lazyCss.locals;

interface ConsoleLogPanelProps {
  componentId: string;
  logs: LogMessage[];
}

export default function ConsoleLogPanel({ componentId, logs }: ConsoleLogPanelProps) {
  const handleClear = useCallback(() => {
    if (componentId) context.clearComLogs(componentId);
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
          logs={logs}
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
