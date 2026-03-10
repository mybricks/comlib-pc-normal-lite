import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Editor, { HandlerType } from "@mybricks/coder/dist/umd";
import context from "../context";
import lazyCss from "./index.lazy.less";

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
  "store.js": "storeJsSource"
};

export function LowcodeView(params: Params) {
  const [selectedFileName, setSelectedFileName] = useState<FileName>(FILES[0]);
  const [modifiedContent, setModifiedContent] = useState<Record<string, string>>({});

  const coderOptions = useMemo(() => {
    const path = `file:///${"组件id"}/${selectedFileName}`;
    if (selectedFileName === "runtime.jsx" || selectedFileName === "store.js") {
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

import TreeView from "./TreeView";

const EDITOR_OPTIONS = {
  fontSize: 12,
  scrollbar: {
    horizontal: "auto",
    vertical: "auto",
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10
  }
}

export default function (params: Params) {
  const codeIns = useRef<HandlerType>(null);
  const [selectFile, setSelectFile] = useState<{ path: string, source: string } | null>(null);
  const files = params.data.files;
  

  // [TODO] 未保存的文件
  const hasUnsavedChanges = false;

  const handleSave = () => {
    console.log("保存")
  }

  const handleEditorChange = () => {
    console.log("代码编辑器内容变化")
  }

  const coderOptions = useMemo(() => {
    if (!selectFile) {
      return {};
    }

    const { path } = selectFile;

    const coderPath = `file:///${"组件id"}/${path}`;
    const suffix = path.split(".").pop() as string;
    if (['jsx', 'jsx'].includes(suffix)) {
      return {
        path: coderPath,
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
    } else {
      return {
        path: coderPath,
        language: suffix
      }
    }
  }, [selectFile])

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
          <TreeView defaultCurrent="runtime.jsx">
            <FilesTree
              files={files}
              path=""
              onSelect={setSelectFile}
            />
          </TreeView>
        </div>
        <div className={css['code-container']}>
          <Editor
            ref={codeIns}
            // [TODO] 当前选中文件代码
            // 当前选中文件显示的内容：有未保存修改则用修改内容，否则从 data 读取
            value={selectFile?.source}
            {...coderOptions}
            options={EDITOR_OPTIONS}
            theme={'light'}
            wrapperClassName={css['coder']}
            onChange={handleEditorChange}
          >
          </Editor>
        </div>
      </div>
    </>
  )
}

const FileIcon = <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/></svg>;

const FilesTree = ({
  files,
  path: parentPath,
  onSelect
}: { files: { fileName: string, source: string }[], path: string, onSelect: (params: { path: string, source: string }) => void }) => {
  const items: ({
    id: string,
    name: string,
    type: "file"
    path: string
  } | {
    id: string,
    name: string,
    type: "directory",
    subTree: { fileName: string, source: string }[]
  }) [] = [];
  const next: Record<string, { fileName: string, source: string, path: string }[]> = {};
  const codeMap: Record<string, string> = {};

  files.forEach(({ fileName, source }) => {
    const split = fileName.split("/");
    // 默认当前不存在空文件夹
    if (split.length === 1) {
      if (parentPath + fileName === "index.tsx") {
        // 默认的index.tsx
        onSelect({ path: "index.jsx", source: decodeURIComponent(source) })
      }
      // 文件
      items.push({
        id: parentPath + fileName,
        path: fileName,
        name: split[0],
        type: "file",
      })
      codeMap[parentPath + fileName] = decodeURIComponent(source);
    } else {
      // 文件夹
      if (!next[split[0]]) {
        next[split[0]] = [];
        items.push({
          id: parentPath + split[0],
          name: split[0],
          type: "directory",
          subTree: next[split[0]],
        })
      }
      next[split[0]].push({ fileName: split.slice(1).join("/"), source, path: fileName })
    }
  })

  return items.map(({ id, name, type, subTree, path }: any) => {
    const isFile = type === "file";
    return (
      <TreeView.Item
        id={id}
        onSelect={isFile ? () => {
          onSelect({ path, source: codeMap[id]});
        } : undefined}
        leadingVisual={isFile ? FileIcon : <TreeView.DirectoryIcon />}
        contentText={name}
        hasSubTree={!isFile}
      >
        {/* {name} */}
        {isFile ? null : (
          <TreeView.SubTree>
            <FilesTree files={subTree} path={`${name}/`} onSelect={onSelect} />
          </TreeView.SubTree>
        )}
      </TreeView.Item>
    )
  })
}