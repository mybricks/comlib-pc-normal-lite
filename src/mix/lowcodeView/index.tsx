import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Editor, { HandlerType } from "@mybricks/coder/dist/umd";
import context from "../context";
import lazyCss from "./index.lazy.less";
import { Events } from "../../utils";

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
  "runtime.md",
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
  "runtime.md": "runtimeMdSource",
};

export const lowcodeViewEvents = new Events<{
  'viewCode': [number, number];
}>();

export default function LowcodeView(params: Params) {
  const [selectedFileName, setSelectedFileName] = useState<FileName>(FILES[0]);
  const [modifiedContent, setModifiedContent] = useState<Record<string, string>>({});

  const coderOptions = useMemo(() => {
    const path = `file:///${"组件id"}/${selectedFileName}`;
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
    if (selectedFileName === "runtime.md") {
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
  }, [selectedFileName]);

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
    let timeOut;

    const off = lowcodeViewEvents.on('viewCode', async ([start, end]) => {
      // [TODO] 闪烁问题
      // 切到runtime代码
      setSelectedFileName("runtime.jsx");

      // 等待编辑器就绪
      let editor = codeIns.current?.editor;
      while (!editor) {
        await new Promise(res => setTimeout(res, 100))
        editor = codeIns.current?.editor
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
    clearFileIfDataChanged("runtime.md");
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
    return ()=>{
      debugger
    }
  }, []);

  return (
    <>
      <div className={css['lowcode-view-toolbar']}>
        <button
          type="button"
          className={`${css['lowcode-view-toolbar-button']} ${hasUnsavedChanges ? css['lowcode-view-toolbar-button-nosave'] : css['lowcode-view-toolbar-button-disabled']}`}
          onClick={handleSave}
          disabled={!hasUnsavedChanges}
        >
          保存
        </button>
      </div>
      <div className={css['lowcode-view']}>
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
            value={code}
            {...coderOptions}
            options={editorOptions}
            theme={'light'}
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
    </>
  )
}