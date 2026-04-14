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

export default function LowcodeView(params: Params) {
  const [modifiedContent, setModifiedContent] = useState<Record<string, string>>({});
  const componentId = params.model?.runtime?.id;

  // 兼容老版本数据：data.files 不存在时，从旧字段迁移
  const data = params.data;
  if (data && !Array.isArray(data.files)) {
    data.files = [];
    const migrate = (fileName: string, source: string, compiled: string) => {
      if (source || compiled) data.files.push({ fileName, source: source || '', compiled: compiled || '' });
    };
    migrate('index.jsx', data.runtimeJsxSource, data.runtimeJsxCompiled);
    migrate('index.less', data.styleSource, data.styleCompiled);
    migrate('config.js', data.configJsSource, data.configJsCompiled);
    migrate('store.js', data.storeJsSource, data.storeJsCompiled);
    migrate('service.js', data.serviceJsSource, data.serviceJsCompiled);
  }
  const files: Array<{ fileName: string; source: string; compiled?: string }> = data.files ?? [];

  const [selectFile, setSelectFile] = useState<{ path: string, source: string, fileName: string } | null>(null);
  const [treeExpandIds, setTreeExpandIds] = useState<string[]>([]);

  // 从 context 读取当前组件的调试状态（强制刷新用的 tick）
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  // 辅助：从 files 中找到初始/回退选中的文件
  const findFallbackFile = useCallback((fileList: typeof files) => {
    const indexFile = fileList.find((f) => f.fileName === "index.jsx");
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

    if (['jsx', 'js'].includes(suffix)) {
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
  }, [selectFile])

  const codeIns = useRef<HandlerType>(null);

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

    const { fileName } = selectFile;

    if (fileName in modifiedContent) {
      const comId = params.model.runtime.id;
      context.updateFile(comId, { fileName, content: modifiedContent[fileName], type: "update" });
      setModifiedContent((prev) => {
        const next = { ...prev };
        delete next[fileName];
        return next;
      });

      // 手动编辑保存后，添加 manual 类型版本记录
      const history = (context as any).getHistory?.(comId);
      if (history) {
        const data = context.getAiComParams(comId)?.data;
        const files = (data?.files ?? [])
          .filter((f: any) => f.source)
          .map((f: any) => ({
            path: f.fileName,
            content: decodeURIComponent(f.source),
          }));

        const existingVersions = await history.listVersions();
        const record = {
          id: crypto.randomUUID(),
          turnId: '',
          label: `V${existingVersions.length}`,
          type: 'manual' as const,
          createdAt: Date.now(),
        };

        await history.addVersion(record, files);

        const updated = await history.listVersions();
        context.notifyVersionsChange(comId, updated);
      }
    }
  }, [selectFile, modifiedContent, params.model]);

  // 仅当当前聚焦的文件有未保存修改时，保存按钮可用
  const hasUnsavedChanges = selectFile && (selectFile.fileName in modifiedContent);

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

  const handleEditorMount = (editor: StandaloneCodeEditor, monaco: Monaco) => {
    if (mountRef.current) {
      mountRef.current();
      mountRef.current = null;
    }
    const model = editor.getModel();
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

      const result = getRelativeImportAtPosition({ column: position.column, lineContent: model!.getLineContent(position.lineNumber)});
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

      // 点击时如果 move 没有设置 relativePath，则重新计算
      if (!relativePath && position) {
        const result = getRelativeImportAtPosition({ column: position.column, lineContent: model!.getLineContent(position.lineNumber)});
        if (result) {
          relativePath = result.importPath;
        }
      }

      const { fileName } = selectFile!;

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
      const filesMap = files.reduce((pre, cur) => {
        pre[cur.fileName] = cur
        return pre;
      }, {})

      const candidates = [selectFileName, `${selectFileName}.jsx`, `${selectFileName}.js`, `${selectFileName}/index.jsx`, `${selectFileName}/index.js`];
      let file;
      let resolvedFileName = selectFileName;
      for (const candidate of candidates) {
        file = filesMap[candidate];
        if (file) {
          resolvedFileName = candidate;
          break;
        }
      }

      if (file) {
        lowcodeViewEvents.emit('viewCode', {
          fileName: resolvedFileName,
        })
      }
    })

    mountRef.current = () => {
      onMouseMove.dispose()
      onMouseDown.dispose()
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
          onClick={handleSave}
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
                defaultCurrent={selectFile?.fileName ?? "index.jsx"}
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
                key={coderOptions.path}
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
      {bottomTab === 'version' && componentId && (
        <div className={css['lowcode-view']}>
          <VersionPanel componentId={componentId} />
        </div>
      )}
    </div>
  )
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