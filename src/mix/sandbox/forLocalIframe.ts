import context from '../context'
import { transformNewFormatForNotifyChanged } from '../../utils/ai-code/md/transformForNotifyChanged'
import {
  hasMybricksGraphDirectory,
  hasMybricksGraphFile,
  isMybricksGraphFile,
  parseMybricksGraph,
  resolveGraphSourceFile,
  type FileLike,
} from '../../utils/ai-code/graph'

let registerSuccess = false

const LOCAL_FILES_ENDPOINT = '/__lingchuang-local-file/files'
const LOCAL_FILES_UPDATE_ENDPOINT = '/__lingchuang-local-file/update'
const LOCAL_FILES_DELETE_ENDPOINT = '/__lingchuang-local-file/delete-files'

type LocalFile = {
  path: string
  content: string
}

async function fetchLocalFiles(): Promise<LocalFile[]> {
  console.log(0, 'designerFs:getFiles')
  const response = await fetch(LOCAL_FILES_ENDPOINT)
  if (!response.ok) {
    throw new Error(`Local files request failed: ${response.status}`)
  }

  const files: unknown = await response.json()
  if (
    !Array.isArray(files)
    || files.some((file) => (
      !file
      || typeof file !== 'object'
      || typeof (file as LocalFile).path !== 'string'
      || typeof (file as LocalFile).content !== 'string'
    ))
  ) {
    throw new Error('Local files request returned an invalid response')
  }

  return files as LocalFile[]
}

async function compileLocalGraphFiles(localFiles: LocalFile[]): Promise<void> {
  // local iframe 链路只编译 YAML graph；不启用 JSDoc/Babel 编译。
  const files: FileLike[] = localFiles.map(file => ({
    fileName: file.path,
  }))

  if (!hasMybricksGraphDirectory(files) || !hasMybricksGraphFile(files)) {
    return
  }

  for (const graphFile of localFiles) {
    if (!isMybricksGraphFile(graphFile.path)) continue

    try {
      const graph = parseMybricksGraph(graphFile.content)
      const targetFileName = resolveGraphSourceFile(graphFile.path, graph, files)
      const notifyChangedValue = transformNewFormatForNotifyChanged(graph.data, targetFileName)

      console.log('[mybricks-graph][local-iframe] compiled data', {
        graphFileName: graphFile.path,
        sourceFileName: graph.fileName,
        data: graph.data,
      })
      console.log('[mybricks-graph][local-iframe] notifyChanged data', {
        fileName: targetFileName,
        value: notifyChangedValue,
      })
      context.notifyChanged(targetFileName, 'update', notifyChangedValue)
    } catch (error) {
      console.error('[mybricks-graph][local-iframe] graph compile failed', {
        graphFileName: graphFile.path,
        error,
      })
    }
  }
}

async function refreshLocalGraph(): Promise<void> {
  const files = await fetchLocalFiles()
  await compileLocalGraphFiles(files)
}

export function registerSandbox(comId: string) {
  if (registerSuccess) {
    return
  }
  registerSuccess = true
  const connectToAI = (window as any)._sandbox_?.connectToAI;
  if (typeof connectToAI !== 'function') {
    // console.warn('[mix/sandbox] window._sandbox_.connectToAI not found, skipping sandbox registration');
    return;
  }

  // const loadingRef: { current: ReturnType<typeof createDesignerLoading> | null } = {
  //   current: null,
  // };

  // const projectRef = getProjectRef(comId);
  // refreshProjectBaseline(comId, projectRef);

  const designerFs = {
      // ── 文件系统 ──────────────────────────────────────────────────────────

      async getFiles(): Promise<LocalFile[]> {
        const files = await fetchLocalFiles()
        await compileLocalGraphFiles(files)
        return files
      },

      async verify() {
        console.log(1, 'designerFs:verify')
        return []
        // const aiComParams = context.component?.params;
        // const messages: any[] = [];
        // const files: any[] = aiComParams?.data?.files ?? [];
        // const componentRuntime = window._sandbox_?.config?.componentRuntime
        // const VERIFY_CONFIG = {
        //   rules: {
        //     // [RULE_IDS.README_CHECK]: 'off' as const,
        //     [RULE_IDS.REQUIREMENT_CHECK]: 'error' as const,
        //   },
        // };

        // if (componentRuntime) {
        //   const { eslint, modules } = componentRuntime
        //   if (eslint) {
        //     const { rules, verify } = eslint
        //     if (rules) {
        //       Object.assign(VERIFY_CONFIG.rules, eslint.rules)
        //     }
        //     if (verify) {
        //       messages.push(...await verify(files))
        //     }
        //   }
        //   if (modules) {
        //     await Promise.all(Object.entries(modules).map(async ([key, value]: any) => {
        //       const eslintVerify = value.eslint.verify
        //       if (eslintVerify) {
        //         messages.push(...await eslintVerify(files))
        //       }
        //     }))
        //   }
        // }

        // messages.push(...await eslintVerify(files, VERIFY_CONFIG))

        // return messages;
      },

      async updateFiles(files: Array<{ path: string; content: string }>) {
        console.log(2, 'designerFs:updateFiles', files)
        const response = await fetch(LOCAL_FILES_UPDATE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files }),
        })
        if (!response.ok) {
          throw new Error(`Local files update failed: ${response.status}`)
        }
        await refreshLocalGraph()
      },

      async deleteFiles(paths: string[]) {
        console.log(3, 'designerFs:deleteFiles', paths)
        const response = await fetch(LOCAL_FILES_DELETE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        })
        if (!response.ok) {
          throw new Error(`Local files delete failed: ${response.status}`)
        }
        await refreshLocalGraph()
      },

      async exportResourceCode(): Promise<string> {
        console.log(4, 'designerFs:exportResourceCode')
        return ''
        // const project = projectRef.current;
        // if (!project) return '';
        // return project.exportResourceCode();
      },

      getEffectiveLibraries() {
        console.log(5, 'designerFs:getEffectiveLibraries')
        return []
        // const project = projectRef.current;
        // if (!project) return [];
        // return project.getEffectiveLibraries();
      },

      // ── 设计器状态 ────────────────────────────────────────────────────────

      async exportDesignerToMessage(): Promise<string> {
        console.log(6, 'designerFs:exportDesignerToMessage')
        return ''
        // const project = projectRef.current;
        // if (!project) return '';
        // return project.exportDesignerToMessage();
      },

      getLogList(query?: { page?: number; pageSize?: number; like?: Record<string, string> }) {
        console.log(7, 'designerFs:getLogList', query)
        // const project = projectRef.current;
        // if (!project) return { total: 0, page: query?.page ?? 1, pageSize: query?.pageSize ?? 20, items: [] };
        // return project.getLogList(query);
      },

      getLogDetail(id: string) {
        console.log(8, 'designerFs:getLogDetail', id)
        // const project = projectRef.current;
        // if (!project) return undefined;
        // return project.getLogDetail(id);
      },

      getRuntimeMode(): string | undefined {
        console.log(9, 'designerFs:getRuntimeMode')
        return ''
        // return context.component?.params?.data?.runtimeMode;
      },

      // /**
      //  * 与 vibeCoding 请求相同的 loading控制器；focusArea 无选区时走 params.onProgress。
      //  */
      // loading(focusArea: any, opts?: DesignerLoadingOptions) {
      //   return createDesignerLoading(comId, focusArea, opts);
      // },
  };

  // connectToAI 注册 Designer；同时把写文件能力挂到 _sandbox_.helpers 供 SPA 调用
  const { history, isRemoteAgent } = connectToAI(comId, {
    designer: designerFs,
    hooks: {
      async beforeRequest({ meta, extra }) {
        console.log(10, 'hooks:beforeRequest', {
          meta,
          extra
        })
        // (window as any).__vibeCodingCallbacks__?.onStart?.();
        
        // loadingRef.current?.setExtra(extra);
        // loadingRef.current?.setLock('lock');

        // context.component?.events.emit('vibing', true);
      },
      async beforeTurn() {
        console.log(11, 'hooks:beforeTurn')
        // const focusArea = (window as any)?._ai_focus_params_?.focusArea;
        // const onProgress = (window as any)?._ai_focus_params_?.onProgress;
        // loadingRef.current = createDesignerLoading(comId, focusArea, { onProgress });
        // refreshProjectBaseline(comId, projectRef);
      },
      async afterTurn(turn: { id?: string }) {
        console.log(12, 'hooks:afterTurn')
        // (window as any)._sendToAgent_source_ = null
        // turnLogs.turnID = turn.id
        // turnLogs.setLog({
        //   message: '[轮次/afterTurn] 本轮结束 — 开始执行轮后处理',
        // })
        // const data = context.component?.params?.data;

        // Array.from(context.chipPromiseIds).forEach((id) => {
        //   context.chipPromiseIds.delete(id)
        //   context.component!.actions!.promiseCancel(id)
        // })

        // const visualAICommit = takePendingVisualAICommit(comId)
        // let sourceChanged = false
        // if (history && !isRemoteAgent && data && typeof data === 'object') {
        //   sourceChanged = await persistAiVersionAfterTurn(comId, history, data, turn, {
        //     visualBranchBeforeFiles: visualAICommit?.beforeFiles,
        //     visualStyleOverlays: visualAICommit?.styleOverlays,
        //   });
        // }
        // if (visualAICommit) {
        //   // remote Agent 会实时回写源码；客户端虽不保存版本，也不能回滚画布上的结果。
        //   if (!sourceChanged && !isRemoteAgent) {
        //     undoRedoManager.rollbackAIBranchCommands()
        //   }
        //   undoRedoManager.clearBranch()
        // }

        // turnLogs.setLog({
        //   message: isRemoteAgent
        //     ? '[轮次/afterTurn] remote Agent 版本由服务端持久化 — 通知 UI 并销毁设计器 loading'
        //     : '[轮次/afterTurn] 版本已持久化 — 通知 UI 并销毁设计器 loading',
        //   dispose: typeof loadingRef.current?.dispose
        // });

        // (window as any).__vibeCodingCallbacks__?.onComplete?.(turn);

        // loadingRef.current?.dispose();
        // loadingRef.current = null;

        // context.component?.events.emit('vibing', false);
      },
      async afterTurnSummary(turn: { id?: string }, summary: string) {
        console.log(13, 'hooks:afterTurnSummary')
        // turnLogs.setLog({
        //   message: '[轮次/afterTurnSummary] 收到 summary 回调 — 开始更新版本摘要',
        //   summary
        // });
        // if (isRemoteAgent) {
        //   turnLogs.setLog({
        //     message: '[轮次/afterTurnSummary] remote Agent 版本由服务端更新 — 跳过客户端写入',
        //   });
        //   return
        // }
        // if (!history || !turn?.id) {
        //   turnLogs.setLog({
        //     message: '[轮次/afterTurnSummary] 已中止 — history 存储或 turn.id 不可用',
        //   });
        //   return
        // };

        // if (TURNS_WITH_MANUAL_VISUAL_VERSION.delete(turn.id)) {
        //   turnLogs.setLog({
        //     message: '[轮次/afterTurnSummary] 视觉分支未检测到 AI 源码修改，跳过 AI 摘要覆盖',
        //   });
        //   return
        // }

        // const target = TURNID_TO_RECORD[turn.id]

        // if (!target) {
        //   turnLogs.setLog({
        //     message: '[轮次/afterTurnSummary] 已中止 — 未找到 turn.id 对应的版本记录',
        //   });
        //   return
        // };

        // turnLogs.setLog({
        //   message: '[轮次/afterTurnSummary] 正在更新历史存储中的版本摘要',
        // });

        // await history.updateVersion(target.id, { summary });

        // turnLogs.setLog({
        //   message: '[轮次/afterTurnSummary] 版本摘要更新成功 — 通知 UI',
        // });

        // target.summary = summary

        // // 通知 UI
        // context.notifyVersionsChange(target);
      },
    },
    // chips: {
    //   ['element-move']: {
    //     def: {
    //       type: 'element-move',
    //       format: formatParsedElementChipMessage,
    //     },
    //     onRemove(params) {
    //       context.chipPromiseIds.delete(params.id)
    //       context.component!.actions!.promiseCancel(params.id)
    //     }
    //   },
    //   ['element-text-update']: {
    //     def: {
    //       type: 'element-text-update',
    //       format: formatParsedElementChipMessage,
    //     },
    //     onRemove(params) {
    //       context.chipPromiseIds.delete(params.id)
    //       context.component!.actions!.promiseCancel(params.id)
    //     }
    //   },
    //   ['element-delete']: {
    //     def: {
    //       type: 'element-delete',
    //       format: formatParsedElementChipMessage,
    //     },
    //     onRemove(params) {
    //       context.chipPromiseIds.delete(params.id)
    //       context.component!.actions!.promiseCancel(params.id)
    //     }
    //   },
    //   ['element-style-update']: {
    //     def: {
    //       type: 'element-style-update',
    //       format: formatParsedElementChipMessage,
    //     },
    //     onRemove(params) {
    //       context.chipPromiseIds.delete(params.id)
    //       context.component!.actions!.promiseCancel(params.id)
    //     }
    //   },
    //   ['element-image-update']: {
    //     def: {
    //       type: 'element-image-update',
    //       format: formatParsedElementChipMessage,
    //     },
    //     onRemove(params) {
    //       context.chipPromiseIds.delete(params.id)
    //       context.component!.actions!.promiseCancel(params.id)
    //     }
    //   },
    //   ['element-svg-update']: {
    //     def: {
    //       type: 'element-svg-update',
    //       format: formatParsedElementChipMessage,
    //     },
    //     onRemove(params) {
    //       context.chipPromiseIds.delete(params.id)
    //       context.component!.actions!.promiseCancel(params.id)
    //     }
    //   }
    // }
  }) ?? {};

  // 注册完成后主动扫描一次本地工程；getFiles 之外的首次生命周期也需要
  // 让已有的 .lingchuang/graph 文档尽早同步到设计器。
  void refreshLocalGraph().catch((error) => {
    console.error('[mybricks-graph][local-iframe] initial compile failed', error)
  })
}
