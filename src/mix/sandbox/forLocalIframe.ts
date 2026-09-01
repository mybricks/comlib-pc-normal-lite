import context from '../context'
import { parse as parseYaml } from 'yaml'
import { completeActiveAuditTransaction, failActiveAuditTransaction, hasActiveAuditTransaction, type AuditResult, type AuditSection, type AuditState } from './auditTransaction'
import { transformLocalIframeFormatForNotifyChanged } from '../../utils/ai-code/md/transformForNotifyChanged'
import {
  hasMybricksGraphDirectory,
  hasMybricksGraphFile,
  isMybricksGraphFile,
  parseMybricksGraph,
  resolveGraphSourceFile,
  type FileLike,
} from '../../utils/ai-code/graph'

(window as any)._local_iframe_notify_map_ = {} as any;

function formatParsedElementChipMessage({ message, chips }: { message: string; chips: Array<{ id: string; data?: any }> }): string {
  let resolved = message;
  const infoBlocks: string[] = [];

  for (const chip of chips) {
    const inlineText = typeof chip.data?.inlineText === 'string' ? chip.data.inlineText : '';
    const detailText = typeof chip.data?.detailText === 'string' ? chip.data.detailText : '';
    resolved = resolved.split(`[[chip:${chip.id}]]`).join(inlineText || detailText || '');
    if (detailText) {
      infoBlocks.push(detailText);
    }
  }

  if (!infoBlocks.length) return resolved;
  return `${resolved}\n\n${infoBlocks.join('\n\n')}`;
}

let registerSuccess = false

const LOCAL_FILES_ENDPOINT = '/lingchuang/api/files'
const LOCAL_FILES_LIST_ENDPOINT = '/lingchuang/api/files/list'
const LOCAL_FILES_READ_ENDPOINT = '/lingchuang/api/files/read'
const LOCAL_FILES_UPDATE_ENDPOINT = '/lingchuang/api/update'
const LOCAL_FILES_DELETE_ENDPOINT = '/lingchuang/api/delete-files'
const LOCAL_COMMANDS_ENDPOINT = '/lingchuang/api/commands'

type LocalFile = {
  path: string
  content: string
}

type LocalFileEntry = {
  path: string
  type: 'file' | 'directory'
  size?: number
}

type LocalCommandResult = {
  stdout: string
  stderr?: string
  exitCode: number
  metadata?: Record<string, unknown>
}

type AgentSandboxCommandOptions = {
  cwd?: string
  env?: Record<string, string>
  inheritEnv?: boolean
  timeoutMs?: number
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

const AUDIT_REVIEW_ROOT = '.lingchuang'
const AUDIT_STATE_LABELS: Record<AuditState, string> = {
  [-1]: '禁止上线',
  0: '需要修复',
  1: '允许上线',
}

function toError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(typeof error === 'string' ? error : fallbackMessage)
}

function getAuditSection(review: string, title: string): AuditSection {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sectionMatch = review.match(new RegExp('^## ' + escapedTitle + '\\s*\\n```ya?ml\\s*\\n([\\s\\S]*?)\\n```', 'm'))
  if (!sectionMatch) {
    throw new Error(`审查报告缺少「${title}」章节的 YAML 元信息`)
  }

  let metadata: unknown
  try {
    metadata = parseYaml(sectionMatch[1])
  } catch (error) {
    throw new Error(`审查报告「${title}」章节的 YAML 无法解析：${toError(error, '未知错误').message}`)
  }

  if (!metadata || typeof metadata !== 'object') {
    throw new Error(`审查报告「${title}」章节的 YAML 元信息格式无效`)
  }

  const { state, desc } = metadata as { state?: unknown; desc?: unknown }
  if (state !== -1 && state !== 0 && state !== 1) {
    throw new Error(`审查报告「${title}」章节的 state 必须是 -1、0 或 1`)
  }
  if (typeof desc !== 'string' || !desc.trim()) {
    throw new Error(`审查报告「${title}」章节缺少 desc`)
  }

  return { state, desc }
}

function formatAuditDetail(review: string): string {
  return review.replace(/^(## [^\n]+)\s*\n```ya?ml\s*\n([\s\S]*?)\n```/gm, (block, heading: string, yaml: string) => {
    try {
      const metadata = parseYaml(yaml) as { state?: unknown; desc?: unknown }
      if (
        !metadata
        || typeof metadata !== 'object'
        || (metadata.state !== -1 && metadata.state !== 0 && metadata.state !== 1)
        || typeof metadata.desc !== 'string'
        || !metadata.desc.trim()
      ) {
        return block
      }

      return `${heading}\n\n**评估状态：${AUDIT_STATE_LABELS[metadata.state]}**\n\n${metadata.desc.trim()}`
    } catch {
      return block
    }
  })
}

async function getCurrentBranch(): Promise<string | undefined> {
  const result = await executeLocalShellCommand('git branch --show-current', { timeoutMs: 10_000 })
  if (result.exitCode !== 0) return undefined
  const branch = result.stdout.trim()
  return branch ? branch.replace(/[^a-zA-Z0-9]/g, '_') : undefined
}

async function readAuditReview(): Promise<string> {
  const entries = await listLocalFiles(AUDIT_REVIEW_ROOT, { recursive: true })
  const reviewPaths = entries
    .filter((entry) => entry.type === 'file' && /(?:^|\/)REVIEW\.md$/.test(entry.path))
    .map((entry) => entry.path)

  if (!reviewPaths.length) {
    throw new Error('本轮审查未生成 .lingchuang/<分支名>/reviews/REVIEW.md')
  }

  const branch = await getCurrentBranch().catch(() => undefined)
  const expectedPath = branch ? `${AUDIT_REVIEW_ROOT}/${branch}/reviews/REVIEW.md` : undefined
  const reviewPath = expectedPath && reviewPaths.includes(expectedPath)
    ? expectedPath
    : reviewPaths.length === 1
      ? reviewPaths[0]
      : undefined

  if (!reviewPath) {
    throw new Error(`无法确定当前分支的审查报告${branch ? `（期望 ${expectedPath}）` : ''}`)
  }

  const review = (await readLocalFiles([reviewPath]))[0]
  if (!review) {
    throw new Error(`无法读取审查报告：${reviewPath}`)
  }
  return review.content
}

async function resolveAuditResult(): Promise<AuditResult> {
  try {
    const review = await readAuditReview()
    console.log('auditReview', {
      process: getAuditSection(review, '总体结论'),
      scope: getAuditSection(review, '影响范围'),
      detail: formatAuditDetail(review),
    })
    return {
      process: getAuditSection(review, '总体结论'),
      scope: getAuditSection(review, '影响范围'),
      detail: formatAuditDetail(review),
    }
  } catch (error) {
    throw toError(error, '审查报告解析失败')
  }
}

async function fetchLocalFiles(): Promise<LocalFile[]> {
  console.log(0, 'localGraph:getFiles')
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

async function getResponseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {}
  return `Request failed: ${response.status}`
}

async function listLocalFiles(path = '', options: { recursive?: boolean } = {}): Promise<LocalFileEntry[]> {
  const params = new URLSearchParams({ path })
  if (options.recursive) params.set('recursive', 'true')
  const response = await fetch(`${LOCAL_FILES_LIST_ENDPOINT}?${params.toString()}`)
  if (!response.ok) throw new Error(await getResponseError(response))
  const payload = await response.json() as { entries?: unknown }
  if (!Array.isArray(payload.entries) || payload.entries.some((entry) => !entry || typeof entry !== 'object' || typeof (entry as LocalFileEntry).path !== 'string' || !['file', 'directory'].includes((entry as LocalFileEntry).type))) {
    throw new Error('Local file list returned an invalid response')
  }
  return payload.entries as LocalFileEntry[]
}

async function readLocalFiles(paths: string[]): Promise<LocalFile[]> {
  if (!paths.length) return []
  const response = await fetch(LOCAL_FILES_READ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(await getResponseError(response))
  const payload = await response.json() as { files?: unknown }
  if (!Array.isArray(payload.files) || payload.files.some((file) => !file || typeof file !== 'object' || typeof (file as LocalFile).path !== 'string' || typeof (file as LocalFile).content !== 'string')) {
    throw new Error('Local file read returned an invalid response')
  }
  return payload.files as LocalFile[]
}

async function updateLocalFiles(files: Array<{ path: string; content: string }>): Promise<void> {
  const response = await fetch(LOCAL_FILES_UPDATE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  if (!response.ok) throw new Error(await getResponseError(response))
  await refreshLocalGraph()
}

async function deleteLocalFiles(paths: string[]): Promise<void> {
  const response = await fetch(LOCAL_FILES_DELETE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
  if (!response.ok) throw new Error(await getResponseError(response))
  await refreshLocalGraph()
}

async function executeLocalShellCommand(command: string, options: AgentSandboxCommandOptions = {}): Promise<LocalCommandResult> {
  const response = await fetch(LOCAL_COMMANDS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      command,
      cwd: options.cwd,
      env: options.env,
      inheritEnv: options.inheritEnv,
      timeoutMs: options.timeoutMs,
    }),
  })
  if (!response.ok) return { stdout: await getResponseError(response), stderr: '', exitCode: 1 }
  if (!response.body) throw new Error('Local command did not return a stream')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: LocalCommandResult | undefined
  const consume = (line: string) => {
    if (!line) return
    const event = JSON.parse(line) as { type?: string; chunk?: unknown; stdout?: unknown; stderr?: unknown; exitCode?: unknown; timedOut?: unknown; aborted?: unknown; message?: unknown }
    if (event.type === 'stdout' && typeof event.chunk === 'string') options.onStdout?.(event.chunk)
    else if (event.type === 'stderr' && typeof event.chunk === 'string') options.onStderr?.(event.chunk)
    else if (event.type === 'error') throw new Error(typeof event.message === 'string' ? event.message : 'Local command failed')
    else if (event.type === 'result' && typeof event.stdout === 'string' && typeof event.stderr === 'string' && typeof event.exitCode === 'number') {
      result = { stdout: event.stdout, stderr: event.stderr, exitCode: event.exitCode, metadata: { timedOut: event.timedOut === true, aborted: event.aborted === true } }
    }
  }
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      consume(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
    if (done) break
  }
  if (buffer) consume(buffer)
  if (!result) throw new Error('Local command stream ended without a result')
  return result
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
      console.log('graph', graph)
      const notifyChangedValue = transformLocalIframeFormatForNotifyChanged(graph.data, targetFileName)
      console.log('notifyChangedValue', {
        id: graph.route,
        value: notifyChangedValue
      });

      (window as any)._local_iframe_notify_map_[graph.route!] = notifyChangedValue

      // console.log('[mybricks-graph][local-iframe] compiled data', {
      //   graphFileName: graphFile.path,
      //   sourceFileName: graph.fileName,
      //   data: graph.data,
      // })
      // console.log('[mybricks-graph][local-iframe] notifyChanged data', {
      //   fileName: targetFileName,
      //   value: notifyChangedValue,
      // })
      context.notifyChanged(graph.route, 'update', notifyChangedValue)
    } catch (error) {
      console.error('[mybricks-graph][local-iframe] graph compile failed', {
        graphFileName: graphFile.path,
        error,
      })
    }
  }
}

export async function refreshLocalGraph(): Promise<void> {
  const files = await fetchLocalFiles()
  await compileLocalGraphFiles(files)
}

export function registerSandbox(comId: string) {
  if (registerSuccess) {
    return
  }
  registerSuccess = true
  const sandboxAPI = (window as any)._sandbox_;
  const connectToAI = sandboxAPI?.connectToAI;
  if (typeof connectToAI !== 'function') {
    // console.warn('[mix/sandbox] window._sandbox_.connectToAI not found, skipping sandbox registration');
    return;
  }

  // const loadingRef: { current: ReturnType<typeof createDesignerLoading> | null } = {
  //   current: null,
  // };

  // const projectRef = getProjectRef(comId);
  // refreshProjectBaseline(comId, projectRef);

  const files = {
      list: listLocalFiles,
      async read(path: string) {
        return (await readLocalFiles([path]))[0] ?? null
      },
      readFiles: readLocalFiles,
      async write(file: LocalFile) {
        await updateLocalFiles([file])
      },
      writeFiles: updateLocalFiles,
      async remove(path: string) {
        await deleteLocalFiles([path])
      },
      removeFiles: deleteLocalFiles,
  }
  const agentSandbox = {
    files,
    commands: {
      execute: executeLocalShellCommand,
    },
  }

  // 直接注册 AgentSandbox，避免通过 V1 getFiles() 全量加载文件内容。
  const { history, isRemoteAgent } = connectToAI(comId, {
    agentSandbox,
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
      async afterTurn(turn: any) {
        console.log(12, 'hooks:afterTurn', turn)
        if (hasActiveAuditTransaction()) {
          try {
            completeActiveAuditTransaction(await resolveAuditResult())
          } catch (error) {
            failActiveAuditTransaction(toError(error, '审查报告解析失败'))
          }
        } else {
          turn.extra?.onComplete?.()
        }
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
    chips: {
      ['element-move']: {
        def: {
          type: 'element-move',
          format: formatParsedElementChipMessage,
        },
        onRemove(params) {
          context.chipPromiseIds.delete(params.id)
          context.component!.actions!.promiseCancel(params.id)
        }
      },
      ['element-text-update']: {
        def: {
          type: 'element-text-update',
          format: formatParsedElementChipMessage,
        },
        onRemove(params) {
          context.chipPromiseIds.delete(params.id)
          context.component!.actions!.promiseCancel(params.id)
        }
      },
      ['element-delete']: {
        def: {
          type: 'element-delete',
          format: formatParsedElementChipMessage,
        },
        onRemove(params) {
          context.chipPromiseIds.delete(params.id)
          context.component!.actions!.promiseCancel(params.id)
        }
      },
      ['element-style-update']: {
        def: {
          type: 'element-style-update',
          format: formatParsedElementChipMessage,
        },
        onRemove(params) {
          context.chipPromiseIds.delete(params.id)
          context.component!.actions!.promiseCancel(params.id)
        }
      },
      ['element-image-update']: {
        def: {
          type: 'element-image-update',
          format: formatParsedElementChipMessage,
        },
        onRemove(params) {
          context.chipPromiseIds.delete(params.id)
          context.component!.actions!.promiseCancel(params.id)
        }
      },
      ['element-svg-update']: {
        def: {
          type: 'element-svg-update',
          format: formatParsedElementChipMessage,
        },
        onRemove(params) {
          context.chipPromiseIds.delete(params.id)
          context.component!.actions!.promiseCancel(params.id)
        }
      }
    }
  }) ?? {};

  // 注册完成后主动扫描一次本地工程；getFiles 之外的首次生命周期也需要
  // 让已有的 .lingchuang/graph 文档尽早同步到设计器。
  void refreshLocalGraph().catch((error) => {
    console.error('[mybricks-graph][local-iframe] initial compile failed', error)
  })
}
