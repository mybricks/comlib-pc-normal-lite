import { Events } from "../../utils/events";
import { FileSystem } from "../../utils/ai-code/render/next-runtime/utils";
import { transformTsx, transformLess } from "../../utils/ai-code/transform-umd";
import { transformNewFormatForNotifyChanged } from "../../utils/ai-code/md/transformForNotifyChanged"
import { parseRequirement } from "../../utils/ai-code/md";
import { randomUUID } from '../utils/uuid'
import { getTimestamp } from "../../utils/time"
import config from './config'
import { validateSkillMd } from "../../utils/ai-code/render/mybricks/gui-card-next/validate-skill-md"
import { undoRedoManager } from '../editors/undoRedo'

const updateFileContent = ({ fileName, files, content }) => {
  const replaceFileName = fileName.replace(/^\//, '')
  const file = files.find((f) => f.fileName === replaceFileName);
  if (file) {
    // 更新
    Object.entries(content).forEach(([key, value]) => {
      file[key] = value;
    });
  } else {
    // 新增
    files.push({ fileName: replaceFileName, ...content });
  }
}

export interface LogMessage {
  method: 'log' | 'info' | 'warn' | 'error';
  data: any[];
  timestamp: string;
  id: string;
  meta?: {
    bindings?: Record<string, any>;
  };
  _?: any
}

export interface ComDebugState {
  isDebugging: boolean;
  bottomTab: 'source' | 'console' | 'version';
  logs: LogMessage[];
  logIdCounter: number;
}

type UserAction = {
  id: string;
  type: string;
  title: string;
  refElement: Element;
}

class Context {
  /** 组件 */
  component: {
    /** 数据源、各类api */
    params: any
    /** 通知引擎更新doc、上下锁 */
    actions: {
      loaded: () => void;
      lock: (id: string, focus: any) => () => void
      unlock: (id: string, focus: any) => void
      notifyChanged: (...params: any) => void

      updatePages: (...params: any) => any
      updateDocs: (...params: any) => any

      promiseComplete: (...params: any) => void
      promiseCancel: (...params: any) => void

      // 推送用户事件
      addUserAction: (action: UserAction) => void
      // 删除用户事件
      removeUserAction: (id) => void
    }
    /** 事件 */
    events: Events<{
      /** 调试相关数据 */
      'debugTarget': any
      /** 文件变更 */
      'fileChange': any
      /** 运行时错误 */
      'runtimeError': Error | null
      /** 编译错误 */
      'compileError': any[]
      /** vibing状态 */
      'vibing': boolean
      /** 打开dos面板 */
      'openDocs': any
      /** 根据id渲染页面 */
      'showPage': string
      /** 根据id隐藏页面 */
      'hidePage': string
    }>;
  } | null = null

  private createComponentActions(actions: NonNullable<Context['component']>['actions']) {
    return {
      ...actions,
      addUserAction: (action: UserAction) => actions.addUserAction.call(actions, action),
      removeUserAction: (id: string) => actions.removeUserAction.call(actions, id),
    }
  }

  /** 全局事件 */
  events = new Events<{ 'ready': boolean }>();

  /** 设置组件 */
  setComponent({ params, actions }) {
    /**
     * [TODO] 这里观察下是不是设置一次就行了？
     * 多次调用，且actions可能是空对象
     */
    if (Object.keys(actions).length) {
      if (!this.component) {
        // @ts-ignore
        const events = new Events<Context['component']['events']>()
        this.component = {
          params,
          actions: this.createComponentActions(actions),
          events
        }
        events.on('debugTarget', (debugTarget: any) => {
          this.setComDebugging(!!debugTarget);
        }, false);
        events.on('fileChange', () => {
          events.emit('runtimeError', null);
        }, false);
      } else {
        this.component.params = params
        this.component.actions = this.createComponentActions(actions)
      }
    }
  }

  /** 通知引擎文档相关更新 */
  notifyChanged(filename?: string, changeType?: 'delete' | 'update', value?: any) {
    try {
      if (!filename) {
        this.component?.actions?.notifyChanged?.()
      } else {
        this.component?.actions?.notifyChanged?.(filename, changeType, value)
      }
    } catch {}
  }

  /** 
   * @lowcode render 注册的插件信息，来自plugin-ai
   */
  plugins?: any

  /** 文件系统 */
  fileSystem?: FileSystem

  /** 临时的，目前只有themes需要用到 */
  projectConfig: { themes?: any[]; } = {}

  /** 第三方图标组件注册表：source → (iconName → Component) */
  iconRegistry: Map<string, Map<string, any>> = new Map()

  registerIcons(source: string, icons: Record<string, any>): void {
    let pkg = this.iconRegistry.get(source)
    if (!pkg) {
      pkg = new Map()
      this.iconRegistry.set(source, pkg)
    }
    for (const [name, comp] of Object.entries(icons)) {
      if (comp != null) pkg.set(name, comp)
    }
  }

  /**
   * 解析组件实际应使用的主题。
   * 若组件未手动修改过主题（data._themesModified 为假），且项目配置了主题，则取项目主题第一个；
   * 否则取组件自身 data.themes 中 activeThemeId 对应的主题。
   */
  resolveActiveTheme() {
    const data = this.component!.params.data
    const projectThemes = this.projectConfig.themes;
    if (!data?._themesModified && projectThemes && projectThemes.length > 0) {
      return projectThemes[0];
    }
    const { activeThemeId, themes } = data?.themes ?? {};
    return themes?.find((t: any) => t.id === activeThemeId);
  }

  /** 临时支持获取画布dom列表 */
  getCanvasList() {
    const shadowRoot = document?.querySelector('#_mybricks-geo-webview_')?.shadowRoot
    if (!shadowRoot) return []
    return shadowRoot.querySelectorAll('[data-desn-page]')
  }

  /** 更新文件 */
  updateFile({ fileName, content, type, noUpdateFileSystem }: any) {
    // 现在只有 jsx、less、js 三种文件
    const aiCom = this.component!

    const aiComParams = aiCom.params;
    const files = aiComParams.data.files;
    const suffix = fileName.split('.').pop();

    if (type === "delete") {
      const deleteIndex = files.findIndex((f) => f.fileName === fileName);
      const fileSystem = this.fileSystem
      if (fileSystem) {
        fileSystem.delete(files[deleteIndex].fileName)
      }
      if (deleteIndex !== -1) {
        files.splice(deleteIndex, 1)
      }
      aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file !== fileName);

      if ( ['jsx', 'tsx'].includes(suffix)) {
        this.notifyChanged(fileName, 'delete')
      }
      aiCom.events.emit('compileError', aiComParams.data._errors)
    } else {
      switch (suffix) {
        case 'jsx':
        case 'tsx':
          try {
            const { transformCode, jsDocMap } = transformTsx(content, { fileName });
            const transformJsDoc = Object.fromEntries(jsDocMap)
            const notifyChangedValue = transformNewFormatForNotifyChanged(transformJsDoc, fileName)
            // if (notifyChangedValue.docs?.length) {
            //   notifyChangedValue.comments = notifyChangedValue.docs.map(({ refSelector }) => {
            //     return {
            //       refSelector,
            //       author: {
            //         name: "Leon"
            //       }
            //     }
            //   })
            // }
            this.notifyChanged(fileName, 'update', notifyChangedValue);
            updateFileContent({
              fileName,
              files,
              content: {
                source: encodeURIComponent(content),
                compiled: encodeURIComponent(transformCode),
                jsDocMap: encodeURIComponent(JSON.stringify(Object.fromEntries(jsDocMap)))
              }
            })
            aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file !== fileName);
            aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file);
            
            if (!noUpdateFileSystem) {
              const fileSystem = this.fileSystem
              if (fileSystem) {
                const file = files.find((f) => f.fileName === fileName);
                fileSystem.update(fileName, {...file, filename: fileName })
              }
            }
          } catch (e: any) {
            // console.error("[@transformTsx error]", e);
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
          break;
        case 'less':
          try {
            const cssModule = transformLess(`.__mybricks_ai_module_id__ {${content}}`, fileName);
            updateFileContent({
              fileName,
              files,
              content: {
                source: encodeURIComponent(content),
                compiled: encodeURIComponent(JSON.stringify(cssModule))
              }
            });
            aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file !== fileName);

            const fileSystem = this.fileSystem
            if (fileSystem) {
              const file = files.find((f) => f.fileName === fileName);
              fileSystem.update(fileName, {...file, filename: fileName })
            }
          } catch (e: any) {
            // console.error("[@transformLess error]", e);
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
          break;
        case 'js':
        case 'ts':
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

            const fileSystem = this.fileSystem
            if (fileSystem) {
              const file = files.find((f) => f.fileName === fileName);
              fileSystem.update(fileName, {...file, filename: fileName })
            }
          } catch (e: any) {
            // console.error("[@transformTsx error]", e);
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

          this.notifyChanged();
          break;
        case 'yaml':
        case 'yml':
        case 'txt':
        case 'json':
        case 'md':
          updateFileContent({
            fileName,
            files,
            content: {
              source: encodeURIComponent(content),
            }
          });

          const frontendMode = config.getFrontendMode()
          if (frontendMode === 'gui_card' && fileName.endsWith('/SKILL.md')) {
            const skillMdErrors = validateSkillMd(fileName, content)
            aiComParams.data._errors = [
              ...aiComParams.data._errors.filter((err: any) => err.file !== fileName),
              ...skillMdErrors,
            ]
          } else {
            aiComParams.data._errors = aiComParams.data._errors.filter(err => err.file !== fileName);
          }

          const fileSystem = this.fileSystem
          if (fileSystem) {
            const file = files.find((f) => f.fileName === fileName);
            fileSystem.update(fileName, {...file, filename: fileName })
          }
          this.notifyChanged();
          break;
        default:
          break;
      }

      if (fileName === "requirement.md") {
        try {
          updateFileContent({
            fileName,
            files,
            content: {
              source: encodeURIComponent(content),
              compiled: parseRequirement(content),
            }
          })
        } catch (e) {
          // console.error("[@parseRequirement error]", e);
        }
      }

      aiCom.events.emit("compileError", aiComParams.data._errors)
    }

    aiCom.events?.emit('fileChange', null);
    (window as any)._mybricksOnEdit_?.();
    aiComParams?.notify?.edit();
  }

  /** 版本记录API */
  history: any

  /** 注册的回滚方法 */
  rollback: any

  /** 注册的版本 diff 方法 */
  diff: any

  /** 版本 */
  version!: Version

  /** 手动编辑保存后，添加 manual 类型版本记录。 */
  async saveManualVersion(updateFiles: string[]): Promise<void> {
    this.saveVisualEditVersion(updateFiles, 'manual')
  }

  /** 可视化编辑提交后保存版本，可标记为手动或 AI 修改。 */
  saveVisualEditVersion(
    updateFiles: string[],
    type: 'manual' | 'ai',
    turnId = '',
  ): VersionRecord | undefined {
    const history = this.history
    if (!history) return;

    const data = this.component!.params?.data;
    const files = (data?.files ?? [])
      .filter((f: any) => f.source)
      .map((f: any) => ({
        path: f.fileName,
        content: decodeURIComponent(f.source),
      }));

    const version = this.version
    const total = version.total
    // 版本号 +1
    version.total = total + 1

    // 新增版本记录
    const record: VersionRecord = {
      id: randomUUID(),
      turnId,
      label: `V${total}`,
      type,
      createdAt: Date.now(),
    };

    const summary = '更新文件:' + 
      updateFiles.reduce((pre, filename) => {
        return pre + `\n- ${filename}`
      }, '')

    version.addPromiseTask(async () => {
      await history.addVersion(record, files);
      await history.updateVersion(record.id, {
        summary
      })
    })

    const versionRecord = {
      ...record,
      summary
    }
    this.notifyVersionsChange(versionRecord);
    return versionRecord
  }

  /** 
   * 版本管理
   */
  versionStateEvents: Events<{ 'change': VersionRecord }> = new Events();

  /**
   * 通知 UI 版本列表变更（统一入口，避免每处都写 emit）。
   * sandbox 在 addVersion / rollback 等操作完成后调用此方法。
   */
  notifyVersionsChange(version: VersionRecord): void {
    this.versionStateEvents.emit('change', version);
  }
  
  /** 每次状态变更通知 LowcodeView 重新读取 */
  comDebugStateEvents: Events<{ 'change': ComDebugState }> = new Events();

  /** 每个组件的调试/日志状态，keyed by componentId */
  comDebugStateMap: ComDebugState = {
    isDebugging: false,
    bottomTab: 'source',
    logs: [],
    logIdCounter: 0,
  };

  setComDebugging(isDebugging: boolean) {
    const state = this.comDebugStateMap;
    state.isDebugging = isDebugging;
    if (isDebugging) {
      // 启动调试：自动切到控制台
      state.bottomTab = 'console';
      state.logs = [{
        id: 'start',
        timestamp: getTimestamp(),
        data: ['开始调试'],
        method: 'log',
        _: {}
      }];
    } else {
      // 取消调试：清空日志，切回源代码
      state.logs = [];
      state.logIdCounter = 0;
      state.bottomTab = 'source';
    }
    this.notifyComDebugState();
  }

  /** 清空日志 */
  clearComLogs() {
    const state = this.comDebugStateMap;
    state.logs = [];
    state.logIdCounter = 0;
    this.notifyComDebugState();
  }

  /** 设置底部lowcodeview展示面板 */
  setComBottomTab(tab: 'source' | 'console' | 'version') {
    const state = this.comDebugStateMap;
    state.bottomTab = tab;
    this.notifyComDebugState();
  }

  /** 通知更新 */
  private notifyComDebugState() {
    this.comDebugStateEvents.emit('change', this.comDebugStateMap);
  }


  /** 日志事件 */
  logEvents: Events<{
    'log': LogMessage;
  }> = new Events();

  /** 推送logger打印的日志 */
  pushLog(method: LogMessage['method'], data: any[], meta?: LogMessage['meta']) {
    const state = this.comDebugStateMap;
    const msg: LogMessage = {
      method,
      timestamp: getTimestamp(),
      data,
      id: String(++state.logIdCounter),
      meta,
    };
    state.logs = [...state.logs, msg];
    this.logEvents.emit('log', msg);
    this.notifyComDebugState();
  }

  chipPromiseIds = new Set<string>()
}

const nextContext = new Context()

export default nextContext

export interface VersionRecord {
  id: string;
  turnId: string;
  label: string;
  type: 'ai' | 'manual' | 'rollback' | 'init';
  createdAt: number;
  summary?: string;
}
export class Version {
  total: number
  promiseStack: Array<() => Promise<any>> = []
  running: boolean = false
  list: VersionRecord[] = [];
  constructor(total) {
    this.total = total
  }

  async runStack() {
    if (this.running) {
      return
    }
    this.running = true

    while (this.promiseStack.length) {
      // 取出最先加入的任务
      try {
        const task = this.promiseStack.shift()
        await task?.()
      } catch (e) {
        console.error('[runStack]', e)
      }
    }

    this.running = false
  }

  addPromiseTask(fn: () => Promise<void>) {
    this.promiseStack.push(fn)
    this.runStack()
  }
}

(window as any).__VIBE_COMPONENT_APIS__ = {
  hasUncommittedChanges: () => {
    return undoRedoManager.hasBranchHistory()
  }
}
