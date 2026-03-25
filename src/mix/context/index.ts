import genVibeCodingAgent from "../agent/vibeCoding";
import { updateRender, updateStyle, updateService, updateStore } from "../../utils/ai-code/transform-umd";
import { Events } from "../../utils/events";
import { parsemd } from "../../utils/ai-code/md"
import { validateCode } from "../avaliableLibraries"
import { getTimestamp } from "../../utils/time"
import { deepClone } from "../utils/normal";

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
  id: number;
  /** V0 / V1 / V2 ... */
  label: string;
  type: 'ai' | 'editor';
  timestamp: string;
  dataSnapshot: Record<string, any>;
  planId?: string;
  summary?: string;
}

class Context {
  aiComParamsMap: Record<string, any> = {};
  aiComEvents: Record<string, Events<{
    'debugTarget': any;
  }>> = {};

  // ─── 版本管理 ───────────────────────────────────────────────────────────────
  versionStateMap: Record<string, VersionSnapshot[]> = {};
  versionStateEvents: Record<string, Events<{ 'change': VersionSnapshot[] }>> = {};

  rxaiMap: Record<string, any> = {};

  getRxai(comId: string) {
    if (!this.rxaiMap[comId]) {
      const rxai = (window as any)._getRxaiByAbstractAgentWithVibeCoding_(comId);
      this.rxaiMap[comId] = rxai;
      rxai?.idb?.trimVersions?.(30);
    }

    return this.rxaiMap[comId];
  }

  async getVersions(comId: string): Promise<VersionSnapshot[]> {
    if (!this.versionStateMap[comId]) {
      const rxai = this.getRxai(comId);
      const versions = rxai?.idb?.getVersions ? (await rxai?.idb?.getVersions?.()) : [];
      this.versionStateMap[comId] = versions.map(({ data }) => {
        return data;
      });
    }

    return this.versionStateMap[comId];
  }

  async addVersion(comId, type, planAgent?) {
    const versions = await this.getVersions(comId);
    const lastVersion = versions[versions.length - 1];
    const id = lastVersion ? lastVersion.id + 1 : 0
    const aiComParams = this.getAiComParams(comId);
    const rxai = this.getRxai(comId);

    if (type === 'ai') {
      const version: VersionSnapshot = {
        id,
        label: `V${id}`,
        type,
        timestamp: getTimestamp({ showMs: false }),
        dataSnapshot: deepClone(aiComParams?.data ?? {}),
        planId: planAgent?.id
      }
      rxai?.idb?.addVersion?.(version.id, version);
      versions.push(version);
      this.versionStateMap[comId] = versions;
      this.getVersionStateEvents(comId).emit('change', versions);
      return version
    } else if (type === 'editor') {
      if (lastVersion && lastVersion.type === 'editor') {
        lastVersion.timestamp = getTimestamp({ showMs: false });
        lastVersion.dataSnapshot = deepClone(aiComParams?.data ?? {});
        rxai?.idb?.updateVersion?.(lastVersion.id, lastVersion)
        this.getVersionStateEvents(comId).emit('change', [...versions]);
        return lastVersion
      } else {
        const version: VersionSnapshot = {
          id,
          label: `V${id}`,
          type,
          timestamp: getTimestamp({ showMs: false }),
          dataSnapshot: deepClone(aiComParams?.data ?? {}),
          planId: planAgent?.id
        }
        rxai?.idb?.addVersion?.(version.id, version);
        versions.push(version);
        this.versionStateMap[comId] = versions;
        this.getVersionStateEvents(comId).emit('change', versions);
        return version
      }
    }    
  }

  async updateVersion(comId, planAgent) {
    const versions = await this.getVersions(comId);
    const updateVersion = versions.find(v => v.planId === planAgent.id)
    const aiComParams = this.getAiComParams(comId);
    const rxai = this.getRxai(comId);

    if (updateVersion) {
      updateVersion.dataSnapshot = deepClone(aiComParams?.data ?? {});
      rxai?.idb?.updateVersion?.(updateVersion.id, updateVersion)
      this.getVersionStateEvents(comId).emit('change', [...versions]);
    }
  }

  async updateVersionWithContent(comId, planAgent, content) {
    const versions = await this.getVersions(comId);
    const updateVersion = versions.find(v => v.planId === planAgent.id)
    const rxai = this.getRxai(comId);

    if (updateVersion) {
      Object.entries(content).forEach(([key, value]) => {
        updateVersion[key] = value;
      })
      rxai?.idb?.updateVersion?.(updateVersion.id, updateVersion)
      this.getVersionStateEvents(comId).emit('change', [...versions]);
    }
  }

  getVersionStateEvents(id: string): Events<{ 'change': VersionSnapshot[] }> {
    if (!this.versionStateEvents[id]) {
      this.versionStateEvents[id] = new Events();
    }
    return this.versionStateEvents[id];
  }

  async rollbackToVersion(comId: string, version: VersionSnapshot) {
    const versions = await this.getVersions(comId);

    const index = versions.findIndex(v => v.id === version.id);

    if (index !== -1) {
      const rxai = (window as any)._getRxaiByAbstractAgentWithVibeCoding_(comId);
      const aiComParams = this.getAiComParams(comId);
      const data = aiComParams.data;
      const rollbackVersion = versions[index];

      Object.entries(rollbackVersion.dataSnapshot).forEach(([key, value]) => {
        data[key] = value;
      });

      const aiVersion = versions.slice(index + 1).find((version) => {
        return version.type === "ai";
      });

      if (aiVersion) {
        rxai?.truncateFrom?.(aiVersion.planId);
      }

      rxai?.idb?.deleteVersion?.(versions[index + 1].id);

      this.versionStateMap[comId] = versions.slice(0, index + 1);
      this.getVersionStateEvents(comId).emit('change', this.versionStateMap[comId]);
    }
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
    }
    this.registerGlobalBridge(id);
  }

  getAiCom(id: string) {
    return this.aiComParamsMap[id];
  }

  /**
   * 注册全局桥接方法，供外部通过 window 调用。
   * 每次组件注册时更新，始终指向最后一个加载的组件。
   *
   * _focusAndSendToVibeAgent_(message)
   *   → 打开该组件的 AI 对话框，并延迟发送消息
   */
  private registerGlobalBridge(id: string) {
    (window as any)._focusAndSendToVibeAgent_ = (message: any) => {
      (window as any)._showAIDialog_?.(id);
      setTimeout(() => {
        (window as any)._sendToFocusVibeAgent_?.({ message });
      }, 500);
    };
  }

  getAiComParams(id: string) {
    return this.aiComParamsMap[id]?.aiComParams;
  }

  projectConfig: { avaliableLibraries?: any[]; themes?: any[] } = {};

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

  updateFile(id, { fileName, content }): void {
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
      case 'README.md':
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
  }
}

export default new Context();
