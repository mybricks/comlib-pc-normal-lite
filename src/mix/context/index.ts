import genVibeCodingAgent from "../agent/vibeCoding";
import { transformTsx, transformLess } from "../../utils/ai-code/transform-umd";
import { Events } from "../../utils/events";
import { getTimestamp } from "../../utils/time"
import { deepClone } from "../utils/normal";
import { parsemd } from "../../utils/ai-code/md";

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

const updateFileContent = ({ fileName, files, content }) => {
  const file = files.find((f) => f.fileName === fileName);
  if (file) {
    // 更新
    Object.entries(content).forEach(([key, value]) => {
      file[key] = value;
    });
  } else {
    // 新增
    files.push({ fileName, ...content });
  }
}

class Context {
  aiComParamsMap: Record<string, any> = {};
  aiComEvents: Record<string, Events<{
    'debugTarget': any;
    'fileChange': any;
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
      (window as any)._mybricksOnEdit_?.({ autoSave: true });
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
      // 兼容老版本数据：将旧字段迁移到 files 数组
      const data = params?.data;
      if (data && !Array.isArray(data.files)) {
        data.files = [];
        const migrate = (fileName: string, source: string, compiled: string) => {
          if (source || compiled) {
            data.files.push({ fileName, source: source || '', compiled: compiled || '' });
          }
        };
        migrate('index.jsx', data.runtimeJsxSource, data.runtimeJsxCompiled);
        migrate('index.less', data.styleSource, data.styleCompiled);
        migrate('config.js', data.configJsSource, data.configJsCompiled);
        migrate('store.js', data.storeJsSource, data.storeJsCompiled);
        migrate('service.js', data.serviceJsSource, data.serviceJsCompiled);
      }
      if (data && !Array.isArray(data._errors)) {
        data._errors = [];
      }
    }
  }
  
  getAiCom(id: string) {
    return this.aiComParamsMap[id];
  }

  getAiComParams(id: string) {
    return this.aiComParamsMap[id]?.aiComParams;
  }

  projectConfig: { availableLibraries?: any[]; themes?: any[] } = {};

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

  updateFile(id, { fileName, content, type }) {
    // 现在只有 jsx、less、js 三种文件
    const aiComParams = this.getAiComParams(id);
    const files = aiComParams.data.files;

    if (type === "delete") {
      const deleteIndex = files.findIndex((f) => f.fileName === fileName);
      if (deleteIndex !== -1) {
        files.splice(deleteIndex, 1)
      }
    } else {
      const suffix = fileName.split('.').pop();

      switch (suffix) {
        case 'jsx':
          try {
            const { transformCode, constituency } = transformTsx(content, { fileName });
            updateFileContent({
              fileName,
              files,
              content: {
                source: encodeURIComponent(content),
                compiled: encodeURIComponent(transformCode),
                constituency
              }
            })
            aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file !== fileName);
            aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file);
          } catch (e: any) {
            console.error("[@transformTsx error]", e);
            updateFileContent({
              fileName,
              files,
              content: {
                source: encodeURIComponent(content)
              }
            })
            aiComParams.data._errors = [
              ...aiComParams.data._errors.filter(err => err.file !== fileName),
              {
                file: fileName,
                message: typeof e === 'string' ? e : (e?.message ?? e?.toString?.() ?? '未知错误'),
                type: 'compile'
              }
            ];
          }
          this.getAiCom(id)?.actions?.notifyChanged?.();
          break;
        case 'less':
          try {
            const prefix = fileName.replace(/[^0-9a-zA-Z_]/g, '_');
            const rawCss = transformLess(`.__mybricks_ai_module_id__ {${content}}`);
            const css = rawCss.replace(
              /(.__mybricks_ai_module_id__\s+)(\.)([-a-zA-Z_][-a-zA-Z0-9_]*)/g,
              `$1.${prefix}-$3`
            );
            updateFileContent({
              fileName,
              files,
              content: {
                source: encodeURIComponent(content),
                compiled: encodeURIComponent(css)
              }
            });
            aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file !== fileName);
          } catch (e: any) {
            console.error("[@transformLess error]", e);
            updateFileContent({
              fileName,
              files,
              content: {
                source: encodeURIComponent(content),
              }
            });
            aiComParams.data._errors = [
              ...aiComParams.data._errors.filter(err => err.file !== fileName),
              {
                file: fileName,
                message: typeof e === 'string' ? e : (e?.message ?? e?.toString?.() ?? '未知错误'),
                type: 'compile'
              }
            ];
          }
          this.getAiCom(id)?.actions?.notifyChanged?.();
          break;
        case 'js':
          try {
            const { transformCode } = transformTsx(content, { fileName })
            updateFileContent({
              fileName,
              files,
              content: {
                source: encodeURIComponent(content),
                compiled: encodeURIComponent(transformCode)
              }
            })
            aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file !== fileName);
          } catch (e: any) {
            console.error("[@transformTsx error]", e);
            updateFileContent({
              fileName,
              files,
              content: {
                source: encodeURIComponent(content),
              }
            })
            aiComParams.data._errors = [
              ...aiComParams.data._errors.filter(err => err.file !== fileName),
              {
                file: fileName,
                message: typeof e === 'string' ? e : (e?.message ?? e?.toString?.() ?? '未知错误'),
                type: 'compile'
              }
            ];
          }

          this.getAiCom(id)?.actions?.notifyChanged?.();
          break;
        default:
          break;
      }

      if (fileName === "README.md") {
        try {
          updateFileContent({
            fileName,
            files,
            content: {
              source: encodeURIComponent(content),
              compiled: parsemd(content),
            }
          })
        } catch (e) {
          console.error("[@parsemd error]", e);
        }
      }
    }

    this.getAiComEvents(id)?.emit('fileChange', { fileName, content, type });
    (window as any)._mybricksOnEdit_?.();
  }
}

export default new Context();
