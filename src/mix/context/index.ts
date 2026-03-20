import genVibeCodingAgent from "../agent/vibeCoding";
import { updateRender, updateStyle, updateService, updateStore } from "../../utils/ai-code/transform-umd";
import { Events } from "../../utils/events";
import { parsemd } from "../../utils/ai-code/md"
import { validateCode } from "../avaliableLibraries"
import { getTimestamp } from "../../utils/time"

export interface LogMessage {
  method: 'log' | 'info' | 'warn' | 'error';
  data: any[];
  timestamp: string;
  id: string;
}

export interface ComDebugState {
  isDebugging: boolean;
  bottomTab: 'source' | 'console' | 'version';
  logs: LogMessage[];
  logIdCounter: number;
}

export interface VersionSnapshot {
  id: string;
  /** V0 / V1 / V2 ... */
  label: string;
  type: 'init' | 'ai' | 'editor';
  /** true 时表示 AI 正在生成中，dataSnapshot 为 null */
  isPending: boolean;
  timestamp: string;
  /** 全量 data 深拷贝；pending 时为 null */
  dataSnapshot: Record<string, any> | null;
}

export interface VersionState {
  versions: VersionSnapshot[];
  /** 版本序号计数器（回滚时会重置到目标版本+1） */
  versionCounter: number;
}

class Context {
  aiComParamsMap: Record<string, any> = {};
  aiComEvents: Record<string, Events<{
    'debugTarget': any;
  }>> = {};

  // ─── 版本管理 ───────────────────────────────────────────────────────────────
  versionStateMap: Record<string, VersionState> = {};
  versionStateEvents: Record<string, Events<{ 'change': VersionState }>> = {};

  private getVersionState(id: string): VersionState {
    if (!this.versionStateMap[id]) {
      this.versionStateMap[id] = { versions: [], versionCounter: 0 };
    }
    return this.versionStateMap[id];
  }

  getVersionStateEvents(id: string): Events<{ 'change': VersionState }> {
    if (!this.versionStateEvents[id]) {
      this.versionStateEvents[id] = new Events();
    }
    return this.versionStateEvents[id];
  }

  private notifyVersionState(id: string) {
    this.getVersionStateEvents(id).emit('change', this.getVersionState(id));
  }

  /** 只读暴露版本状态（供 UI 组件调用） */
  getVersionHistory(id: string): VersionState {
    return this.getVersionState(id);
  }

  /** 组件首次注册时，深拷贝 data 作为 V0 */
  initVersion(id: string) {
    const state = this.getVersionState(id);
    if (state.versions.length > 0) return; // 已初始化，跳过
    const aiComParams = this.getAiComParams(id);
    state.versions = [{
      id: `v${state.versionCounter}`,
      label: `V${state.versionCounter}`,
      type: 'init',
      isPending: false,
      timestamp: getTimestamp({ showMs: false }),
      dataSnapshot: JSON.parse(JSON.stringify(aiComParams?.data ?? {})),
    }];
    state.versionCounter = 1;
    this.notifyVersionState(id);
  }

  /** AI 对话开始时，推入一条 isPending=true 的版本记录 */
  startAIPendingVersion(id: string) {
    const state = this.getVersionState(id);
    // 若已有 pending，跳过（防止重复）
    if (state.versions.some(v => v.isPending)) return;
    state.versions = [...state.versions, {
      id: `v${state.versionCounter}`,
      label: `V${state.versionCounter}`,
      type: 'ai',
      isPending: true,
      timestamp: getTimestamp({ showMs: false }),
      dataSnapshot: null,
    }];
    state.versionCounter++;
    this.notifyVersionState(id);
  }

  /** AI complete 时，将当前 data 全量快照填入最后一条 pending 版本 */
  commitAIVersion(id: string) {
    const state = this.getVersionState(id);
    const pendingIdx = state.versions.findIndex(v => v.isPending);
    if (pendingIdx === -1) return;
    const aiComParams = this.getAiComParams(id);
    const updated = [...state.versions];
    updated[pendingIdx] = {
      ...updated[pendingIdx],
      isPending: false,
      timestamp: getTimestamp({ showMs: false }),
      dataSnapshot: JSON.parse(JSON.stringify(aiComParams?.data ?? {})),
    };
    state.versions = updated;
    this.notifyVersionState(id);
  }

  /** AI error 时，移除 pending 版本记录，并回退版本序号 */
  cancelAIPending(id: string) {
    const state = this.getVersionState(id);
    const pendingIdx = state.versions.findIndex(v => v.isPending);
    if (pendingIdx === -1) return;
    // 回退计数器（因为 pending 版本被丢弃）
    state.versionCounter = Math.max(0, state.versionCounter - 1);
    state.versions = state.versions.filter(v => !v.isPending);
    this.notifyVersionState(id);
  }

  /**
   * 编辑器保存时调用。
   * - 若最后一条 committed 版本是 editor 类型，覆盖其 snapshot（不产生新版本）
   * - 否则，追加一条新的 editor 版本
   */
  saveEditorVersion(id: string) {
    const state = this.getVersionState(id);
    const aiComParams = this.getAiComParams(id);
    const snapshot = JSON.parse(JSON.stringify(aiComParams?.data ?? {}));
    // 找最后一条非 pending 的版本
    const lastCommitted = [...state.versions].reverse().find(v => !v.isPending);
    
    if (lastCommitted && lastCommitted.type === 'editor') {
      // 覆盖 snapshot，不生成新版本
      const idx = state.versions.findIndex(v => v.id === lastCommitted.id);
      const updated = [...state.versions];
      updated[idx] = {
        ...updated[idx],
        timestamp: getTimestamp({ showMs: false }),
        dataSnapshot: snapshot,
      };
      state.versions = updated;
    } else {
      // 追加新的 editor 版本
      state.versions = [...state.versions, {
        id: `v${state.versionCounter}`,
        label: `V${state.versionCounter}`,
        type: 'editor',
        isPending: false,
        timestamp: getTimestamp({ showMs: false }),
        dataSnapshot: snapshot,
      }];
      state.versionCounter++;
    }
    this.notifyVersionState(id);
  }

  /**
   * 回滚到指定版本：
   * 1. 将 snapshot 逐字段赋给 data
   * 2. 截断该版本之后的所有版本
   * 3. 通知组件重新渲染
   */
  rollbackToVersion(id: string, versionId: string) {
    const state = this.getVersionState(id);
    const targetIdx = state.versions.findIndex(v => v.id === versionId);
    if (targetIdx === -1) return;
    const target = state.versions[targetIdx];
    if (target.isPending || !target.dataSnapshot) return;

    const aiCom = this.getAiCom(id);
    const data = aiCom?.aiComParams?.data;
    if (!data) return;

    // 逐字段赋值
    const snap = target.dataSnapshot;
    // 先清除 data 中多余的 key
    Object.keys(data).forEach(key => {
      if (!(key in snap)) delete data[key];
    });
    // 再赋值
    Object.keys(snap).forEach(key => {
      data[key] = snap[key];
    });

    // 截断版本列表（保留 0..targetIdx），并重置计数器
    state.versions = state.versions.slice(0, targetIdx + 1);
    state.versionCounter = targetIdx + 1;
    this.notifyVersionState(id);

    // 通知组件重新渲染
    aiCom?.actions?.notifyChanged?.();
    (window as any)._mybricksOnEdit_?.();
  }
  // ─────────────────────────────────────────────────────────────────────────────

  logEvents: Record<string, Events<{
    'log': LogMessage;
  }>> = {};

  /** 每个组件的调试/日志状态，keyed by componentId */
  comDebugStateMap: Record<string, ComDebugState> = {};

  /** 每次状态变更通知 LowcodeView 重新读取 */
  comDebugStateEvents: Record<string, Events<{ 'change': ComDebugState }>> = {};

  getComDebugState(id: string): ComDebugState {
    if (!this.comDebugStateMap[id]) {
      this.comDebugStateMap[id] = {
        isDebugging: false,
        bottomTab: 'source',
        logs: [],
        logIdCounter: 0,
      };
    }
    return this.comDebugStateMap[id];
  }

  getComDebugStateEvents(id: string) {
    if (!this.comDebugStateEvents[id]) {
      this.comDebugStateEvents[id] = new Events();
    }
    return this.comDebugStateEvents[id];
  }

  private notifyComDebugState(id: string) {
    this.getComDebugStateEvents(id).emit('change', this.getComDebugState(id));
  }

  setComDebugging(id: string, isDebugging: boolean) {
    const state = this.getComDebugState(id);
    state.isDebugging = isDebugging;
    if (isDebugging) {
      // 启动调试：自动切到控制台
      state.bottomTab = 'console';
      state.logs = [{
        id: 'start',
        timestamp: getTimestamp(),
        data: ['开始调试'],
        method: 'log',
      }];
    } else {
      // 取消调试：清空日志，切回源代码
      state.logs = [];
      state.logIdCounter = 0;
      state.bottomTab = 'source';
    }
    this.notifyComDebugState(id);
  }

  setComBottomTab(id: string, tab: 'source' | 'console' | 'version') {
    const state = this.getComDebugState(id);
    state.bottomTab = tab;
    this.notifyComDebugState(id);
  }

  clearComLogs(id: string) {
    const state = this.getComDebugState(id);
    state.logs = [];
    state.logIdCounter = 0;
    this.notifyComDebugState(id);
  }

  getAiComEvents(id: string) {
    let events = this.aiComEvents[id];
    if (!events) {
      events = this.aiComEvents[id] = new Events();
      // 自动同步调试状态到 comDebugStateMap
      events.on('debugTarget', (debugTarget: any) => {
        this.setComDebugging(id, !!debugTarget);
      }, false);
    }
    return events;
  }

  getLogEvents(id: string) {
    let events = this.logEvents[id];
    if (!events) {
      events = this.logEvents[id] = new Events();
    }
    return events;
  }

  pushLog(id: string, method: LogMessage['method'], data: any[]) {
    const state = this.getComDebugState(id);
    const msg: LogMessage = {
      method,
      timestamp: getTimestamp(),
      data,
      id: String(++state.logIdCounter),
    };
    state.logs = [...state.logs, msg];
    this.getLogEvents(id).emit('log', msg);
    this.notifyComDebugState(id);
  }

  setAiCom(id: string, { params, actions }) {
    if (actions.notifyChanged || actions.getFocusArea || actions.lock || actions.unlock) {
      this.aiComParamsMap[id] = { aiComParams: params, actions };
      // 首次注册时初始化 V0 快照
      this.initVersion(id);
    }
  }

  getAiCom(id: string) {
    return this.aiComParamsMap[id];
  }

  getAiComParams(id: string) {
    return this.aiComParamsMap[id]?.aiComParams;
  }

  agent: any = {
    vibeCoding: null,
  };

  createVibeCodingAgent({ register }) {
    if (!this.agent.vibeCoding) {
      const that = this;
      const vibeCoding = genVibeCodingAgent({ context: that });
      this.agent.vibeCoding = vibeCoding;
      register(vibeCoding);
    }
  }

  plugins: any;

  /** 生成中：start 后展示流式界面，stream 传全量（多次即流式），end 删 data 并渲染，error 展示错误面板 */
  generate = {
    start: (id: string) => {
      const aiComParams = this.getAiComParams(id);
      if (!aiComParams?.data) return;
      aiComParams.data.generate = true;
      aiComParams.data.generateFileName = '';
      aiComParams.data.generateContent = '';
      aiComParams.data.generateError = false;
      aiComParams.data.generateErrorMessage = '';
      this.getAiCom(id)?.actions?.notifyChanged?.();
    },
    stream: (id: string, payload: { fileName: string; content: string }) => {
      const aiComParams = this.getAiComParams(id);
      if (!aiComParams?.data) return;
      aiComParams.data.generateFileName = payload.fileName ?? '';
      aiComParams.data.generateContent = payload.content ?? '';
      this.getAiCom(id)?.actions?.notifyChanged?.();
    },
    error: (id: string, message: string) => {
      const aiComParams = this.getAiComParams(id);
      if (!aiComParams?.data) return;
      aiComParams.data.generate = true;
      aiComParams.data.generateError = true;
      aiComParams.data.generateErrorMessage = message ?? '';
      this.getAiCom(id)?.actions?.notifyChanged?.();
    },
    end: (id: string) => {
      const aiComParams = this.getAiComParams(id);
      if (!aiComParams?.data) return;
      delete aiComParams.data.generate;
      delete aiComParams.data.generateFileName;
      delete aiComParams.data.generateContent;
      delete aiComParams.data.generateError;
      delete aiComParams.data.generateErrorMessage;
      this.getAiCom(id)?.actions?.notifyChanged?.();
    },
  };

  updateFile(id, { fileName, content }): Promise<void> | void {
    const aiComParams = this.getAiComParams(id);

    switch (fileName) {
      case "model.json":
        aiComParams.data.modelConfig = encodeURIComponent(content);
        break;
      case "runtime.jsx":
        return updateRender({
          data: aiComParams.data,
          success: () => {
            const aiCom = this.getAiCom(id);
            aiCom?.actions?.notifyChanged?.();
          }},
          content
        );
      case "style.less":
        updateStyle({
          id,
          data: aiComParams.data,
          success: () => {
            this.getAiCom(id)?.actions?.notifyChanged?.();
          },
        }, content);
        break;
      case "config.js":
        aiComParams.data.configJsCompiled = encodeURIComponent(content);
        aiComParams.data.configJsSource = encodeURIComponent(content);
        break;
      case "store.js":
        return updateStore({
          data: aiComParams.data,
          success: () => {
            this.getAiCom(id)?.actions?.notifyChanged?.();
          },
        }, content);
      case "service.js":
        return updateService({
          data: aiComParams.data,
          success: () => {
            this.getAiCom(id)?.actions?.notifyChanged?.();
          },
        }, content);
      case "com.json":
        aiComParams.data.componentConfig = encodeURIComponent(content);
        const oriInputs = aiComParams.input.get();
        const oriOutputs = aiComParams.output.get();
        let parsed: { title?: string; inputs?: unknown[]; outputs?: unknown[] };
        try {
          parsed = JSON.parse(content);
        } catch {
          break;
        }
        const title = parsed?.title;
        const inputs = Array.isArray(parsed?.inputs) ? parsed.inputs : [];
        const outputs = Array.isArray(parsed?.outputs) ? parsed.outputs : [];

        inputs.forEach((item: any) => {
          const { id, title, desc, schema } = item ?? {};
          if (id == null) return;
          const oriInputIndex = oriInputs.findIndex((input) => input.id === id);
          if (oriInputIndex !== - 1) {
            // 修改
            const oriInput = oriInputs[oriInputIndex];
            oriInput.setTitle(title);
            oriInput.setSchema(schema);
            oriInputs.splice(oriInputIndex, 1)
          } else {
            // 新增
            aiComParams.input.add({
              id,
              title,
              desc,
              schema,
            });
          }
        })

        oriInputs.forEach((input) => {
          aiComParams.input.remove(input.id);
        })

        outputs.forEach((item: any) => {
          const { id, title, desc, schema } = item ?? {};
          if (id == null) return;
          const oriOutputIndex = oriOutputs.findIndex((output) => output.id === id);
          if (oriOutputIndex !== - 1) {
            // 修改
            const oriOutput = oriOutputs[oriOutputIndex];
            oriOutput.setTitle(title);
            oriOutput.setSchema(schema);
            oriOutputs.splice(oriOutputIndex, 1)
          } else {
            // 新增
            aiComParams.output.add({
              id,
              title,
              desc,
              schema,
            });
          }
        })

        oriOutputs.forEach((output) => {
          aiComParams.output.remove(output.id);
        })

        if (title) {
          aiComParams?.setTitle?.(title);
        }
        break;
      case 'runtime.md':
        aiComParams.data.runtimeMdSource = encodeURIComponent(content);
        try {
          aiComParams.data.runtimeMdCompiled = parsemd(content);
        } catch (e) {
          console.log("[@parsemd error]", e);
        }
        break;
      case 'mock.json':
        aiComParams.data.mockJsonSource = encodeURIComponent(content);
        try {
          JSON.parse(content);
          aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file !== 'mock.json');
        } catch (e: any) {
          aiComParams.data._errors = [
            ...aiComParams.data._errors.filter(err => err.file !== 'mock.json'),
            {
              file: 'mock.json',
              message: typeof e === 'string' ? e : (e?.message ?? e?.toString?.() ?? '未知错误'),
              type: 'compile'
            }
          ];
        }
        break;
      default:
        break;
    }

    (window as any)._mybricksOnEdit_?.();
  }
}

export default new Context();
