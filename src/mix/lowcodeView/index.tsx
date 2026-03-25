import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Editor, { HandlerType } from "@mybricks/coder/dist/umd";
import context from "../context";
import ConsoleLogPanel from "./console";
import VersionPanel from "./version";
import lazyCss from "./index.lazy.less";
import { Events } from "../../utils";
import { useDarkMode } from "../../utils/hooks";

const css = lazyCss.locals;

interface Params {
  data: any;
  model: any;
}

const FILES = [
  // "model.json",
  "runtime.jsx",
  "style.less",
  "store.js",
  "service.js",
  "mock.json",
  "README.md",
  // "config.js",
  // "com.json"
] as const;

type FileName = typeof FILES[number];

const FILES_MAP: Record<string, string> = {
  "model.json": "modelConfig",
  "style.less": "styleSource",
  "runtime.jsx": "runtimeJsxSource",
  "config.js": "configJsSource",
  "com.json": "componentConfig",
  "store.js": "storeJsSource",
  "service.js": "serviceJsSource",
  "README.md": "runtimeMdSource",
  "mock.json": "mockJsonSource",
};

export const lowcodeViewEvents = new Events<{
  'viewCode': [number, number];
}>();

export default function LowcodeView(params: Params) {
  const [selectedFileName, setSelectedFileName] = useState<FileName>(FILES[0]);
  const [modifiedContent, setModifiedContent] = useState<Record<string, string>>({});

  const componentId = params.model?.runtime?.id;

  // 从 context 读取当前组件的调试状态（强制刷新用的 tick）
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  // 订阅当前组件的调试/日志状态变更
  useEffect(() => {
    if (!componentId) return;
    const off = context.getComDebugStateEvents(componentId).on('change', () => forceUpdate(), false);
    return () => off();
  }, [componentId]);

  const debugState = componentId ? context.getComDebugState(componentId) : null;
  const isDebugging = debugState?.isDebugging ?? false;
  const bottomTab = debugState?.bottomTab ?? 'source';
  const consoleLogs = debugState?.logs ?? [];

  const setBottomTab = useCallback((tab: 'source' | 'console' | 'version') => {
    if (componentId) context.setComBottomTab(componentId, tab);
  }, [componentId]);

  const coderOptions = useMemo(() => {
    const path = `file:///${componentId}/${selectedFileName}`;
    if (selectedFileName === "runtime.jsx" || selectedFileName === "store.js" || selectedFileName === "service.js") {
      return {
        path,
        language: 'typescript',
        encodeValue: false,
        minimap: { enabled: false },
        eslint: {
          parserOptions: { ecmaVersion: '2020', sourceType: 'module' }
        },
        babel: false,
        autoSave: false,
        preview: false,
        isTsx: true
      };
    }
    // if (selectedFileName === "config.js") {
    //   return {
    //     path,
    //     language: 'javascript',
    //   };
    // }
    // .md 文件需用 Monaco 的 language id: 'markdown'（不能用 'md'）
    if (selectedFileName === "README.md") {
      return {
        path,
        language: "markdown",
        minimap: { enabled: false },
      };
    }
    if (FILES.includes(selectedFileName)) {
      return {
        path,
        language: selectedFileName.split(".").pop()
      };
    }
    return {};
  }, [selectedFileName, componentId]);

  // 当前选中文件显示的内容：有未保存修改则用修改内容，否则从 data 读取
  const code = useMemo(() => {
    if (selectedFileName in modifiedContent) {
      return modifiedContent[selectedFileName];
    }
    const raw = params.data[FILES_MAP[selectedFileName]];
    return raw != null ? decodeURIComponent(raw) : "";
  }, [selectedFileName, modifiedContent, params.data]);

  const codeIns = useRef<HandlerType>(null);

  useEffect(() => {
    let decorationsCollection;
    let lastEditor;
    let timeOut;

    const off = lowcodeViewEvents.on('viewCode', async ([start, end]) => {
      // [TODO] 闪烁问题
      // 切到runtime代码
      setSelectedFileName("runtime.jsx");
      setBottomTab('source');

      // 等待编辑器就绪
      let editor = codeIns.current?.editor;
      while (!editor) {
        await new Promise(res => setTimeout(res, 100))
        editor = codeIns.current?.editor
      }

      // 如果编辑器实例发生变化（key 导致重新挂载），重置 decorationsCollection
      if (editor !== lastEditor) {
        decorationsCollection = undefined;
        lastEditor = editor;
      }

      clearTimeout(timeOut);
      let isRuntime = editor.getModel()!.uri.path.endsWith('runtime.jsx')

      while (!isRuntime) {
        await new Promise(res => setTimeout(res, 100))
        isRuntime = editor.getModel()!.uri.path.endsWith('runtime.jsx')
      }

      const currentDeltaDecoration = {
        range: {
          startLineNumber: start,
          startColumn: 1,
          endLineNumber: end,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: 'highlighted-line',
          linesDecorationsClassName: 'highlighted-line-decoration',
        }
      }

      if (!decorationsCollection) {
        decorationsCollection = editor.createDecorationsCollection([currentDeltaDecoration]);
      } else {
        decorationsCollection.clear();
        decorationsCollection.append([currentDeltaDecoration])
      }

      editor.revealLineInCenter(start)
      editor.setPosition({ lineNumber: start, column: 1 })
      editor.focus()

      timeOut = setTimeout(() => {
        decorationsCollection.clear();
      }, 3000)
    }, true)

    return () => {
      off();
    }
  }, [])

  const handleEditorChange = useCallback((value: string) => {
    setModifiedContent((prev) => ({
      ...prev,
      [selectedFileName]: value,
    }));
  }, [selectedFileName]);

  const handleSave = useCallback(() => {
    const dataKey = FILES_MAP[selectedFileName];
    if (dataKey && params.data && selectedFileName in modifiedContent) {
      context.updateFile(params.model.runtime.id, { fileName: selectedFileName, content: modifiedContent[selectedFileName] });
      setModifiedContent((prev) => {
        const next = { ...prev };
        delete next[selectedFileName];
        return next;
      });
      // 编辑器保存后记录/更新编辑器版本快照
      context.addVersion(params.model.runtime.id, "editor")
    }
  }, [selectedFileName, modifiedContent, params.data]);

  // 仅当当前聚焦的文件有未保存修改时，保存按钮可用
  const hasUnsavedChanges = selectedFileName in modifiedContent;

  const editorOptions = useMemo(() => ({
    fontSize: 12,
    scrollbar: {
      horizontal: "auto",
      vertical: "auto",
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10
    }
  }), []);

  // 按需覆盖：仅当某 data 字段变化时，只清除对应文件的未保存内容，其它文件保留
  const clearFileIfDataChanged = useCallback((fileName: FileName) => {
    setModifiedContent((prev) => {
      if (!(fileName in prev)) {
        return {
          ...prev,
        };
      }
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
  }, []);

  // useEffect(() => {
  //   clearFileIfDataChanged("model.json");
  // }, [params.data?.modelConfig]);

  useEffect(() => {
    clearFileIfDataChanged("style.less");
  }, [params.data?.styleSource]);

  useEffect(() => {
    clearFileIfDataChanged("runtime.jsx");
  }, [params.data?.runtimeJsxSource]);

  useEffect(() => {
    clearFileIfDataChanged("README.md");
  }, [params.data?.runtimeMdSource]);

  // useEffect(() => {
  //   clearFileIfDataChanged("config.js");
  // }, [params.data?.configJsSource]);

  // useEffect(() => {
  //   clearFileIfDataChanged("com.json");
  // }, [params.data?.componentConfig]);

  useEffect(() => {
    clearFileIfDataChanged("store.js");
  }, [params.data?.storeJsSource]);

  useEffect(() => {
    clearFileIfDataChanged("service.js");
  }, [params.data?.serviceJsSource]);

  useEffect(() => {
    clearFileIfDataChanged("mock.json");
  }, [params.data?.mockJsonSource]);

  const isDark = useDarkMode();
  const editorTheme = isDark ? 'vs-dark' : 'light';

  return (
    <div className={css['lowcode-view-container']}>
      <div className={css['lowcode-view-toolbar']}>
        <div className={css['lowcode-view-toolbar-tabs']}>
          <div
            className={`${css['lowcode-view-toolbar-tab']} ${bottomTab === 'source' ? css['lowcode-view-toolbar-tab-active'] : ''}`}
            onClick={() => setBottomTab('source')}
          >
            源代码
          </div>
          {isDebugging && (
            <div
              className={`${css['lowcode-view-toolbar-tab']} ${bottomTab === 'console' ? css['lowcode-view-toolbar-tab-active'] : ''}`}
              onClick={() => setBottomTab('console')}
            >
              控制台{consoleLogs.length > 0 ? ` (${consoleLogs.length})` : ''}
            </div>
          )}
          <div
            className={`${css['lowcode-view-toolbar-tab']} ${bottomTab === 'version' ? css['lowcode-view-toolbar-tab-active'] : ''}`}
            onClick={() => setBottomTab('version')}
          >
            版本
          </div>
        </div>
        <button
          type="button"
          className={`${css['lowcode-view-toolbar-button']} ${hasUnsavedChanges ? css['lowcode-view-toolbar-button-nosave'] : css['lowcode-view-toolbar-button-disabled']}`}
          onClick={handleSave}
          disabled={!hasUnsavedChanges}
        >
          保存
        </button>
      </div>
      {/* source 面板：用 display 控制显隐，避免销毁 Editor */}
      <div className={css['lowcode-view']} style={{ display: bottomTab === 'source' ? 'flex' : 'none' }}>
        <div className={css['file-list']}>
          {FILES.map((fileName) => (
            <div
              key={fileName}
              className={`${css['file-item']} ${selectedFileName === fileName ? css['file-item-active'] : ""}`}
              onClick={() => setSelectedFileName(fileName)}
            >
              {fileName in modifiedContent ? "*" : ""}{fileName}
            </div>
          ))}
        </div>
        <div className={css['code-container']}>
          <Editor
            ref={codeIns}
            key={coderOptions.path}
            value={code}
            {...coderOptions}
            options={editorOptions}
            theme={editorTheme}
            wrapperClassName={css['coder']}
            onChange={handleEditorChange}
            // onMount={(editor, monaco) => {
            //   console.log("[@编辑器初始化]", {
            //     editor,
            //     monaco
            //   })
            // }}
          >
          </Editor>
        </div>
      </div>
      {/* console 面板：用 display 控制显隐，保持 console-feed 状态 */}
      {isDebugging && (
        <div className={css['lowcode-view']} style={{ display: bottomTab === 'console' ? 'flex' : 'none' }}>
          <ConsoleLogPanel componentId={componentId} logs={consoleLogs} />
        </div>
      )}
      {/* 版本面板 */}
      {bottomTab === 'version' && componentId && (
        <div className={css['lowcode-view']}>
          <VersionPanel componentId={componentId} />
        </div>
      )}
    </div>
  )
}