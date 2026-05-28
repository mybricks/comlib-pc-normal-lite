import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Editor, { HandlerType, Monaco, StandaloneCodeEditor } from "@mybricks/coder/dist/umd";
import context from "../context";
import ConsoleLogPanel from "./console";
import VersionPanel from "./version";
import * as lazyCss from "./index.lazy.less";
import { Events } from "../../utils";
import { useDarkMode } from "../../utils/hooks";
import TreeView from "./tree";
import { filesJsonToTree } from "./filesToTree";
import type { FileTreeNode } from "./filesToTree";
import { getLazyCss } from './utils/css';
import { registerLowcodeViewMonacoContext } from '../eslint/monaco-language-service';
import { undoRedoManager } from "../editors/undoRedo";

const css = getLazyCss(lazyCss)

interface Params {
  data: any;
  model: any;
}

export const lowcodeViewEvents = new Events<{
  'viewCode': {fileName: string, codeLine?: [number, number]};
}>();

// 从编辑器某一行的某列，提取相对路径引用（./xxx 或 ../xxx）
// 返回 { importPath, startColumn, endColumn } 或 null
const getRelativeImportAtPosition = ({
  column,
  lineContent
}) => {
  // [TODO] 判断不够健壮
  const relativePathRegex = /(?:from\s+|import\s+)["'](\.[^"']+)["']/;
  const match = relativePathRegex.exec(lineContent);
  if (!match) return null;

  const importPath = match[1];
  const pathStartIndex = lineContent.indexOf(importPath, match.index);
  const startColumn = pathStartIndex + 1;
  const endColumn = startColumn + importPath.length;

  // 如果提供了列，判断是否在路径范围内
  if (column !== undefined && (column < startColumn || column > endColumn)) {
    return null;
  }

  return { importPath, startColumn, endColumn };
};

function LowcodeView(params: Params) {
  const [modifiedContent, setModifiedContent] = useState<Record<string, string>>({});
  const componentId = params.model?.runtime?.id;

  // 兼容老版本数据：data.files 不存在时，从旧字段迁移
  const data = params.data;
  const files: Array<{ fileName: string; source: string; compiled?: string }> = data.files ?? [];

  const [selectFile, setSelectFile] = useState<{ path: string, source: string, fileName: string } | null>(null);
  const [treeExpandIds, setTreeExpandIds] = useState<string[]>([]);

  // 从 context 读取当前组件的调试状态（强制刷新用的 tick）
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  // 辅助：从 files 中找到初始/回退选中的文件
  const findFallbackFile = useCallback((fileList: typeof files) => {
    const indexFile = fileList.find((f) => f.fileName === "index.tsx");
    return indexFile ?? fileList[0] ?? null;
  }, []);

  // 订阅当前组件的调试/日志状态变更，并初始化选中文件
  useEffect(() => {
    if (!componentId) return;
    const off = context.getComDebugStateEvents(componentId).on('change', () => forceUpdate(), false);
    const fallback = findFallbackFile(files);
    if (fallback) {
      setSelectFile({
        path: fallback.fileName,
        source: decodeURIComponent(fallback.source),
        fileName: fallback.fileName,
      });
    } else {
      setSelectFile(null);
    }
    return () => off();
  }, [componentId]);

  // 用稳定的 key 字符串表示 files 快照，用于监听变化
  const filesKey = files.map((f) => `${f.fileName}:${f.source}`).join('|');

  // 监听 files 变化：刷新当前选中文件内容 / 处理文件被删除的情况
  const prevFilesKeyRef = useRef<string>('');
  useEffect(() => {
    if (prevFilesKeyRef.current === filesKey) return;
    prevFilesKeyRef.current = filesKey;

    setSelectFile((prev) => {
      if (!prev) {
        // 没有选中文件时，尝试初始化
        const fallback = findFallbackFile(files);
        if (!fallback) return null;
        return { path: fallback.fileName, source: decodeURIComponent(fallback.source), fileName: fallback.fileName };
      }

      const current = files.find((f) => f.fileName === prev.fileName);
      if (current) {
        // 文件仍存在，刷新 source
        return { ...prev, source: decodeURIComponent(current.source) };
      }

      // 当前选中文件已被删除，回退选择
      const fallback = findFallbackFile(files);
      if (!fallback) return null;
      return { path: fallback.fileName, source: decodeURIComponent(fallback.source), fileName: fallback.fileName };
    });
  }, [filesKey]);

  const debugState = componentId ? context.getComDebugState(componentId) : null;
  const isDebugging = debugState?.isDebugging ?? false;
  const bottomTab = debugState?.bottomTab ?? 'source';
  const consoleLogs = debugState?.logs ?? [];

  const setBottomTab = useCallback((tab: 'source' | 'console' | 'version') => {
    if (componentId) context.setComBottomTab(componentId, tab);
  }, [componentId]);

  const coderOptions = useMemo(() => {
    if (!selectFile) {
      return {}
    }
    const { fileName } = selectFile;
    const suffix = fileName.split('.').pop();

    if (!suffix) {
      return {}
    }

    const path = `file:///${componentId}/${fileName}`;

    if (['jsx', 'js', 'tsx', 'ts'].includes(suffix)) {
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
    } else if (suffix === 'md') {
      return {
        path,
        language: "markdown",
        minimap: { enabled: false },
      };
    } else {
      return {
        path,
        language: suffix
      }
    }
  }, [selectFile, componentId]);

  const code = useMemo(() => {
    if (!selectFile) {
      return ""
    }

    const { fileName } = selectFile;

    if (fileName in modifiedContent) {
      return modifiedContent[fileName]
    }

    return selectFile.source
  }, [selectFile, modifiedContent])

  const codeIns = useRef<HandlerType>(null);

  // 用 ref 保持 selectFile 和 files 的最新引用，避免 handleEditorMount 闭包过期
  const selectFileRef = useRef(selectFile);
  useEffect(() => { selectFileRef.current = selectFile; }, [selectFile]);
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  useEffect(() => {
    let decorationsCollection;
    let lastEditor;
    let timeOut;

    const off = lowcodeViewEvents.on('viewCode', async ({ fileName, codeLine }) => {
      // [TODO] 闪烁问题
      // 切到runtime代码
      // setSelectedFileName("runtime.jsx");
      setBottomTab('source');
      const file = files.find(f => f.fileName === fileName)

      if (!file) {
        return
      }

      setSelectFile({
        path: file.fileName,
        source: decodeURIComponent(file.source),
        fileName: file.fileName,
      })

      // 计算父目录路径列表，展开目录并滚动到目标文件
      const segments = file.fileName.split('/').filter(Boolean);
      if (segments.length > 1) {
        const parentPaths: string[] = [];
        for (let i = 1; i < segments.length; i++) {
          parentPaths.push(segments.slice(0, i).join('/'));
        }
        setTreeExpandIds(prev => {
          const set = new Set(prev);
          parentPaths.forEach(p => set.add(p));
          return Array.from(set);
        });
      }

      clearTimeout(timeOut);

      // 等待编辑器就绪，且 model 已切换到目标文件
      // 必须同时满足两个条件，避免拿到旧 editor 或旧 model
      let editor = codeIns.current?.editor;
      let modelPath = editor?.getModel()?.uri.path ?? '';
      while (!editor || !modelPath.endsWith(fileName)) {
        await new Promise(res => setTimeout(res, 50))
        editor = codeIns.current?.editor
        modelPath = editor?.getModel()?.uri.path ?? ''
      }

      // editor 实例发生变化（key 导致重新挂载），重置 decorationsCollection
      if (editor !== lastEditor) {
        decorationsCollection = undefined;
        lastEditor = editor;
      }

      if (codeLine) {
        const [start, end] = codeLine;
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
      }
      editor.focus()

      timeOut = setTimeout(() => {
        decorationsCollection?.clear();
      }, 3000)
    }, true)

    return () => {
      off();
    }
  }, [componentId])

  const handleEditorChange = useCallback((value: string) => {
    if (!selectFile) {
      return
    }
    setModifiedContent((prev) => ({
      ...prev,
      [selectFile.fileName]: value,
    }));
  }, [selectFile]);

  const handleSave = useCallback(async () => {
    if (!selectFile) {
      return
    }

    const { fileName, source } = selectFile;

    if (fileName in modifiedContent) {
      const comId = params.model.runtime.id;
      // context.updateFile(comId, { fileName, content: modifiedContent[fileName], type: "update" });
      setModifiedContent((prev) => {
        const next = { ...prev };
        delete next[fileName];
        return next;
      });

      const currentSource = modifiedContent[fileName]
      const previousSource = source;

      undoRedoManager.execute({
        execute() {
          context.updateFile(comId, { fileName, content: currentSource, type: "update" });
          context.saveManualVersion(comId, [fileName]);
        },
        undo() {
          context.updateFile(comId, { fileName, content: previousSource, type: "update" });
          context.saveManualVersion(comId, [fileName]);
        },
      })

      // 手动编辑保存后，添加 manual 类型版本记录
      // await context.saveManualVersion(comId, [fileName]);
    }
  }, [selectFile, modifiedContent, params.model]);

  // 保存所有有未保存修改的文件
  const handleSaveAll = useCallback(async () => {
    const dirtyFileNames = Object.keys(modifiedContent);
    if (dirtyFileNames.length === 0) return;

    const comId = params.model.runtime.id;
    const filesMap = files.reduce((acc, f) => { acc[f.fileName] = f; return acc; }, {} as Record<string, typeof files[0]>);

    // 快照当前所有未保存内容，避免异步过程中被覆盖
    const snapshot = { ...modifiedContent };

    setModifiedContent((prev) => {
      const next = { ...prev };
      dirtyFileNames.forEach(name => delete next[name]);
      return next;
    });

    const currentFiles: any = []
    const previousFiles: any = []

    dirtyFileNames.forEach((fileName) => {
      currentFiles.push({
        fileName,
        content: snapshot[fileName]
      })

      previousFiles.push({
        fileName,
        content: decodeURIComponent(filesMap[fileName].source)
      })
    });

    undoRedoManager.execute({
      execute() {
        currentFiles.forEach(({ fileName, content }) => {
          context.updateFile(comId, { fileName, content, type: "update" });
        })
        context.saveManualVersion(comId, currentFiles.map((f) => f.fileName));
      },
      undo() {
        previousFiles.forEach(({ fileName, content }) => {
          context.updateFile(comId, { fileName, content, type: "update" });
        })
        context.saveManualVersion(comId, previousFiles.map((f) => f.fileName));
      },
    });
  }, [modifiedContent, params.model, files]);

  // 当存在任意未保存文件时，保存按钮可用
  const hasUnsavedChanges = Object.keys(modifiedContent).length > 0;

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
  // const clearFileIfDataChanged = useCallback((fileName: FileName) => {
  //   setModifiedContent((prev) => {
  //     if (!(fileName in prev)) {
  //       return {
  //         ...prev,
  //       };
  //     }
  //     const next = { ...prev };
  //     delete next[fileName];
  //     return next;
  //   });
  // }, []);

  const mountRef = useRef<any>(null)
  // 保存各文件的滚动位置，key 为 fileName
  const scrollPositionsRef = useRef<Record<string, { scrollTop: number; scrollLeft: number }>>({});

  // 从 model URI 中提取 fileName（如 file:///componentId/path/to/file.tsx → path/to/file.tsx）
  const getFileNameFromModel = (editor: StandaloneCodeEditor): string | null => {
    const uri = editor.getModel()?.uri;
    if (!uri) return null;
    // uri.path 形如 /componentId/fileName，去掉开头的 /componentId/
    const parts = uri.path.split('/');
    // 去掉第一个空串和 componentId
    return parts.slice(2).join('/') || null;
  };

  // 用 ref 保持 handleSaveAll 的最新引用，避免 addCommand 闭包过期
  const handleSaveRef = useRef(handleSaveAll);
  useEffect(() => {
    handleSaveRef.current = handleSaveAll;
  }, [handleSaveAll]);

  const handleEditorMount = (editor: StandaloneCodeEditor, monaco: Monaco) => {
    if (componentId) {
      registerLowcodeViewMonacoContext({
        componentId,
        monaco,
        editor,
        files,
      });
    }

    if (mountRef.current) {
      mountRef.current();
      mountRef.current = null;
    }

    // 监听 Ctrl+S / Cmd+S，触发保存操作
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current();
    });
    // 在 macOS 上额外监听 Control+S（与 Cmd+S 区别）
    editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current();
    });
    const decorationsCollection = editor.createDecorationsCollection([]);
    let relativePath = "";

    const onMouseMove = editor.onMouseMove(({ event, target }) => {
      if (!event.metaKey) {
        decorationsCollection.clear()
        relativePath = ""
        return
      }

      const position = target?.position;
      if (!position) return;

      const currentModel = editor.getModel();
      if (!currentModel) return;
      const result = getRelativeImportAtPosition({ column: position.column, lineContent: currentModel.getLineContent(position.lineNumber)});
      if (!result) {
        decorationsCollection.clear();
        relativePath = "";
        return;
      }

      const { importPath, startColumn, endColumn } = result;
      relativePath = importPath;

      decorationsCollection.set([{
        range: new monaco.Range(position.lineNumber, startColumn, position.lineNumber, endColumn),
        options: {
          inlineClassName: 'import-path-link',
        }
      }]);
    });

    const onMouseDown = editor.onMouseDown(({ event, target }) => {
      if (!event.metaKey) {
        decorationsCollection.clear();
        relativePath = ""
        return
      }

      const position = target?.position;
      const currentModel = editor.getModel();
      // 点击时如果 move 没有设置 relativePath，则重新计算
      if (!relativePath && position && currentModel) {
        const result = getRelativeImportAtPosition({ column: position.column, lineContent: currentModel.getLineContent(position.lineNumber)});
        if (result) {
          relativePath = result.importPath;
        }
      }

      const currentSelectFile = selectFileRef.current;
      if (!currentSelectFile) return;
      const { fileName } = currentSelectFile;

      let currentPath = fileName.split('/');
      currentPath = currentPath.slice(0, currentPath.length - 1)
      const targetPath = relativePath.split('/');

      targetPath.forEach((path) => {
        if (path === ".") {
        } else if (path === "..") {
          currentPath.pop();
        } else {
          currentPath.push(path)
        }
      })

      const selectFileName = currentPath.join('/')
      const currentFiles = filesRef.current;
      const filesMap = currentFiles.reduce((pre, cur) => {
        pre[cur.fileName] = cur
        return pre;
      }, {} as Record<string, typeof currentFiles[0]>)

      const extensions = ['jsx', 'js', 'tsx', 'ts'];
      const candidates = [
        selectFileName,
        ...extensions.map(ext => `${selectFileName}.${ext}`),
        ...extensions.map(ext => `${selectFileName}/index.${ext}`)
      ];
      const resolvedFileName = candidates.find(candidate => filesMap[candidate]) || selectFileName;
      const file = filesMap[resolvedFileName];

      if (file) {
        lowcodeViewEvents.emit('viewCode', {
          fileName: resolvedFileName,
        })
      }
    })

    const onCopy = (e: ClipboardEvent) => {
      const codeContent = e.clipboardData?.getData('text/plain')
      window._sandbox_.config.componentRuntime?.workspace?.onCodeEditorCopy({ filename: selectFileRef.current?.fileName, code: codeContent })
    }

    editor.getDomNode()?.addEventListener('copy', onCopy)

    // 实时保存当前文件的滚动位置
    const onScroll = editor.onDidScrollChange(() => {
      const fileName = getFileNameFromModel(editor);
      if (fileName) {
        scrollPositionsRef.current[fileName] = {
          scrollTop: editor.getScrollTop(),
          scrollLeft: editor.getScrollLeft(),
        };
      }
    });

    // model 切换完成后恢复对应文件的滚动位置（时机最准确）
    const onModelChange = editor.onDidChangeModel(() => {
      const fileName = getFileNameFromModel(editor);
      if (!fileName) return;
      const saved = scrollPositionsRef.current[fileName];
      if (saved) {
        editor.setScrollTop(saved.scrollTop);
        editor.setScrollLeft(saved.scrollLeft);
      } else {
        editor.setScrollTop(0);
        editor.setScrollLeft(0);
      }
    });

    mountRef.current = () => {
      onMouseMove.dispose()
      onMouseDown.dispose()
      onScroll.dispose()
      onModelChange.dispose()
      editor.getDomNode()?.removeEventListener('copy', onCopy)
    }
  }

  const isDark = useDarkMode();
  const editorTheme = isDark ? 'vs-dark' : 'light';

  return (
    <div className={css['lowcode-view-container']}>
      <div className={css['lowcode-view-toolbar']}>
        <div className={css['lowcode-view-toolbar-tabs']}>
          <div className={css['lowcode-view-toolbar-left']}>
            <div
              className={`${css['lowcode-view-toolbar-tab']} ${bottomTab === 'source' ? css['lowcode-view-toolbar-tab-active'] : ''}`}
              onClick={() => setBottomTab('source')}
            >
              源代码
            </div>
            <div
              className={`${css['lowcode-view-toolbar-tab']} ${bottomTab === 'version' ? css['lowcode-view-toolbar-tab-active'] : ''}`}
              onClick={() => setBottomTab('version')}
            >
              版本
            </div>
          </div>
          <div className={css['lowcode-view-toolbar-right']}>
            {isDebugging && (
              <div
                className={`${css['lowcode-view-toolbar-tab']} ${bottomTab === 'console' ? css['lowcode-view-toolbar-tab-active'] : ''}`}
                onClick={() => setBottomTab('console')}
              >
                控制台{consoleLogs.length > 0 ? ` (${consoleLogs.length})` : ''}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          className={`${css['lowcode-view-toolbar-button']} ${hasUnsavedChanges ? css['lowcode-view-toolbar-button-nosave'] : css['lowcode-view-toolbar-button-disabled']}`}
          onClick={handleSaveAll}
          disabled={!hasUnsavedChanges}
        >
          保存
        </button>
      </div>
      {/* source 面板：用 display 控制显隐，避免销毁 Editor */}
      <div className={css['lowcode-view']} style={{ display: bottomTab === 'source' ? 'flex' : 'none' }}>
        {files.length === 0 ? (
          <div className={css['code-empty']}>暂无代码文件</div>
        ) : (
          <>
            <div className={css['file-list']}>
              <TreeView
                defaultCurrent={selectFile?.fileName ?? "index.tsx"}
                expandIds={treeExpandIds}
                isDark={isDark}
              >
                <FilesTree
                  nodes={filesJsonToTree(files)}
                  onSelect={(file) => {
                    setSelectFile(file)
                  }}
                />
              </TreeView>
            </div>
            <div className={css['code-container']}>
              <Editor
                ref={codeIns}
                value={code}
                {...coderOptions}
                options={editorOptions}
                theme={editorTheme}
                wrapperClassName={css['coder']}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
              />
            </div>
          </>
        )}
      </div>
      {/* console 面板：用 display 控制显隐，保持 console-feed 状态 */}
      {isDebugging && (
        <div className={css['lowcode-view']} style={{ display: bottomTab === 'console' ? 'flex' : 'none' }}>
          <ConsoleLogPanel componentId={componentId} logs={consoleLogs} />
        </div>
      )}
      {/* 版本面板 */}
      {componentId && (
        <div className={css['lowcode-view']} style={{ display: bottomTab === 'version' ? 'flex' : 'none' }}>
          <VersionPanel render={bottomTab === 'version'} componentId={componentId} />
        </div>
      )}
    </div>
  )
}

export default function(params: Params) {
  const [render, setRender] = useState(false)
  useEffect(() => {
    const off = context.events.on('ready', () => {
      setRender(true)
    })

    return () => {
      off()
    }
  }, [])

  return render && <LowcodeView {...params} />
}

const FileIcon = <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/></svg>;

const FilesTree = ({
  nodes,
  onSelect
}: {
  nodes: FileTreeNode[];
  onSelect: (params: { path: string; source: string; fileName: string }) => void;
}) => {
  return (
    <>
      {nodes.map((node) => {
        const isFile = node.type === "file";
        return (
          <TreeView.Item
            key={node.fileName}
            id={node.fileName}
            onSelect={isFile ? () => {
              onSelect({
                path: node.name,
                source: decodeURIComponent((node as any).source ?? ""),
                fileName: (node as any).fileName,
              });
            } : undefined}
            leadingVisual={isFile ? FileIcon : <TreeView.DirectoryIcon />}
            contentText={node.name}
            hasSubTree={!isFile}
          >
            {isFile ? null : (
              <TreeView.SubTree>
                <FilesTree nodes={(node as any).children} onSelect={onSelect} />
              </TreeView.SubTree>
            )}
          </TreeView.Item>
        );
      })}
    </>
  );
}
