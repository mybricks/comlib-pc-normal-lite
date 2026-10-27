import { Events } from '../../../utils/events'

const CHANNEL = 'lingxi:project-runtime'
const PLAYGROUND_ORIGIN = 'lingxi-playground://app'
const MAX_LOG_LINES = 500
const MAX_LOG_CHARS = 128 * 1024

function limitOutput(output: string): string {
  const bounded = output.slice(-MAX_LOG_CHARS)
  const lines = bounded.split('\n')
  return lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES).join('\n') : bounded
}

export type ProjectRuntimeStatus = {
  projectId: string
  state: 'starting' | 'ready' | 'stopping' | 'error' | 'stopped'
  message: string
  url?: string
  errorDetail?: string
}

export type ProjectRuntimeProcessInfo = {
  pid?: number
  startedAt: string
  scriptName: string
  directory: string
}

export type ProjectRuntimeUpdate = {
  status: ProjectRuntimeStatus
  logChunk?: string
  processLogChunk?: string
  processLogSnapshot?: string
  processInfo?: ProjectRuntimeProcessInfo
  logOnly?: boolean
  logSnapshot?: boolean
  detail?: string
  phase?: string
}

type RuntimeMessage =
  | { channel: typeof CHANNEL; type: 'update'; update: ProjectRuntimeUpdate }
  | { channel: typeof CHANNEL; type: 'start-result' | 'stop-result' | 'restart-result'; requestId: string; status?: ProjectRuntimeStatus; error?: string }

type DirectPlaygroundRuntime = {
  start(options?: { timeoutMs?: number }): Promise<ProjectRuntimeStatus>
  stop?(): Promise<ProjectRuntimeStatus>
  restart?(): Promise<ProjectRuntimeStatus>
  getSnapshot?(): ProjectRuntimeUpdate | undefined
  events: {
    on(type: 'update', listener: (update: ProjectRuntimeUpdate) => void): () => void
  }
}

/**
 * comlib 侧的 ProjectRuntime 门面。
 *
 * 它不启动子进程；只经由 Playground 转发 desktop ProjectRuntime 的统一事件流。
 * 命令行组件可订阅 `runtimeUpdate` 逐段输出日志，画布则只在 ready 时消费 runtimeUrl。
 */
export class Runtime {
  events = new Events<{
    runtimeUrl: {
      url: string
    }
    runtimeUpdate: ProjectRuntimeUpdate
  }>()

  #status?: ProjectRuntimeStatus
  #processInfo?: ProjectRuntimeProcessInfo
  #output = ''
  #processOutput = ''
  #nextRequestId = 0
  #directRuntime?: DirectPlaygroundRuntime
  #pending = new Map<string, {
    resolve: (status: ProjectRuntimeStatus) => void
    reject: (error: Error) => void
  }>()

  constructor() {
    window.addEventListener('message', this.#onMessage)
    const app = (window as any).__APP__
    const directRuntime = app?.projectRuntime as DirectPlaygroundRuntime | undefined
    const directEvents = app?.projectRuntimeEvents as DirectPlaygroundRuntime['events'] | undefined
    if (directRuntime && directEvents) {
      this.#directRuntime = { ...directRuntime, events: directEvents }
      console.info('[comlib:project-runtime] using direct Playground event bus')
      directEvents.on('update', this.#receiveUpdate)
      const snapshot = directRuntime.getSnapshot?.()
      if (snapshot) this.#receiveUpdate(snapshot)
      void this.start().catch((error) => {
        console.error('[comlib:project-runtime] initial start failed', error)
      })
      return
    }
    if (window.parent !== window) {
      console.info('[comlib:project-runtime] subscribing to Playground', {
        parentOrigin: PLAYGROUND_ORIGIN,
        currentOrigin: window.location.origin,
      })
      try {
        window.parent.postMessage({ channel: CHANNEL, type: 'subscribe' }, PLAYGROUND_ORIGIN)
      } catch (error) {
        console.error('[comlib:project-runtime] subscribe failed', error)
      }
      // 组件库首次挂载即确保运行时已启动。ProjectRuntime.start 对存活进程幂等，
      // 因此重复挂载或来自其他入口的 start 都只会复用现有进程并回放当前状态。
      void this.start().catch((error) => {
        console.error('[comlib:project-runtime] initial start failed', error)
      })
    }
  }

  start(options: { timeoutMs?: number } = {}): Promise<ProjectRuntimeStatus> {
    if (this.#directRuntime) return this.#directRuntime.start(options)
    return this.#request('start', options)
  }

  stop(): Promise<ProjectRuntimeStatus> {
    if (this.#directRuntime) {
      return this.#directRuntime.stop?.() ?? Promise.reject(new Error('停止功能不可用，请重启客户端。'))
    }
    return this.#request('stop')
  }

  restart(): Promise<ProjectRuntimeStatus> {
    if (this.#directRuntime) {
      return this.#directRuntime.restart?.() ?? Promise.reject(new Error('重启功能不可用，请重启客户端。'))
    }
    return this.#request('restart')
  }

  #request(type: 'start' | 'stop' | 'restart', options?: { timeoutMs?: number }): Promise<ProjectRuntimeStatus> {
    if (window.parent === window) return Promise.reject(new Error('ProjectRuntime Playground 桥接不可用。'))
    const requestId = `${Date.now()}-${++this.#nextRequestId}`
    return new Promise<ProjectRuntimeStatus>((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject })
      try {
        window.parent.postMessage({ channel: CHANNEL, type, requestId, options }, PLAYGROUND_ORIGIN)
      } catch (error) {
        this.#pending.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  getSnapshot(): { status?: ProjectRuntimeStatus; output: string; processOutput: string; processInfo?: ProjectRuntimeProcessInfo } {
    return { status: this.#status, output: this.#output, processOutput: this.#processOutput, processInfo: this.#processInfo }
  }

  open(url: string): void {
    const parsed = new URL(url)
    this.events.emit('runtimeUrl', { url: parsed.toString() })
  }

  #onMessage = (event: MessageEvent<RuntimeMessage>): void => {
    if (event.source !== window.parent || event.origin !== PLAYGROUND_ORIGIN) return
    const message = event.data
    if (!message || message.channel !== CHANNEL) return
    if (message.type === 'update') return this.#receiveUpdate(message.update)
    if (!['start-result', 'stop-result', 'restart-result'].includes(message.type)) return
    if (!('requestId' in message)) return
    const pending = this.#pending.get(message.requestId)
    if (!pending) return
    this.#pending.delete(message.requestId)
    if (message.error) {
      console.error('[comlib:project-runtime] start failed', { requestId: message.requestId, error: message.error })
      pending.reject(new Error(message.error))
    }
    else if (message.status) {
      console.info('[comlib:project-runtime] start completed', {
        requestId: message.requestId,
        state: message.status.state,
        url: message.status.url,
      })
      pending.resolve(message.status)
    }
    else pending.reject(new Error('项目运行时未返回启动结果。'))
  }

  #receiveUpdate = (update: ProjectRuntimeUpdate): void => {
    if (update.logSnapshot || (update.status.state === 'starting' && this.#status?.state !== 'starting')) {
      this.#output = ''
      this.#processOutput = ''
      this.#processInfo = undefined
    }
    if (update.processInfo) this.#processInfo = update.processInfo
    if (update.processLogSnapshot !== undefined) {
      this.#processOutput = limitOutput(update.processLogSnapshot)
    } else if (update.processLogChunk) {
      this.#processOutput = limitOutput(this.#processOutput + update.processLogChunk)
    }
    this.#status = update.status
    const chunk = update.logChunk ?? (update.logOnly || update.logSnapshot ? '' : `[灵创] ${update.status.message}\n`)
    if (chunk) this.#output = limitOutput(this.#output + chunk)
    if (!update.logOnly) {
      console.info('[comlib:project-runtime] received update', {
        state: update.status.state,
        phase: update.phase,
        url: update.status.url,
      })
    }
    this.events.emit('runtimeUpdate', update)
    if (update.status.state === 'ready' && update.status.url) this.open(update.status.url)
  }
}
