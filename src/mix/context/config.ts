import * as antd from "antd";
import echartsForReact from '../../utils/echarts-for-react'
import zhCN from 'antd/locale/zh_CN'
import { isLoggerMethod } from '../../utils/ai-code/render/logger'
import context from './index'
import dayjs from "dayjs";

export const DYNAMIC_MODULE = Symbol('DYNAMIC_MODULE')

const DEFAULT_ENTRY_FILE = 'index.tsx'
const MODULE_FRONTEND_TYPE = 'frontend'
const DEFAULT_FRONTEND_MODE = 'default'

type CompatibleAvailableLibrary = {
  name: string
  version: string
  readme: string
  urls: string[]
  library: string
  validator: {
    validatePlugin: () => void
  }
}[]

function createRuntimeLogger() {
  return new Proxy({}, {
    get(_, prop: string | symbol) {
      if (!isLoggerMethod(prop)) {
        return () => {};
      }
      return (...args: any[]) => {
        if (context.comDebugStateMap.isDebugging) {
          context.pushLog(prop, args);
        }
      };
    }
  });
}

class Config {
  getEntryFile() {
    const componentRuntime = window._sandbox_.config.componentRuntime

    if (!componentRuntime) {
      return DEFAULT_ENTRY_FILE
    }

    const modules = componentRuntime.modules

    if (modules) {
      const frontend: any = Object.entries(modules).find(([key, module]: any) => module.type === MODULE_FRONTEND_TYPE)?.[1]
      return frontend?.entryFile || DEFAULT_ENTRY_FILE
    } else {
      return componentRuntime?.entryFile || DEFAULT_ENTRY_FILE
    }
  }

  // 前端渲染模式
  /**
   * kds_web
   * gui_card
   * default
   */
  getFrontendMode() {
    return 'local-iframe'
    if (window.MYBRICKS_LOCAL_IFRAME) {
      return 'local-iframe'
    }
    const componentRuntime = window._sandbox_.config.componentRuntime
    if (!componentRuntime) {
      return DEFAULT_FRONTEND_MODE
    }

    const modules = componentRuntime.modules

    if (modules) {
      const frontend: any = Object.entries(modules).find(([key, module]: any) => module.type === MODULE_FRONTEND_TYPE)?.[1]
      return frontend?.mode || DEFAULT_FRONTEND_MODE
    } else {
      return componentRuntime?.mode || DEFAULT_FRONTEND_MODE
    }
  }

  getFrontendModeConfig() {
     const componentRuntime = window._sandbox_.config.componentRuntime
    if (!componentRuntime) {
      return {}
    }

    const modules = componentRuntime.modules

    if (modules) {
      const frontend: any = Object.entries(modules).find(([key, module]: any) => module.type === MODULE_FRONTEND_TYPE)?.[1]
      return frontend?.[frontend.mode] || {}
    } else {
      return {}
    }
  }

  /** 配置mybricks文档 */
  getMyBricksUsage() {
    const componentRuntime = window._sandbox_.config.componentRuntime
    if (!componentRuntime) {
      return null
    }

    const modules = componentRuntime.modules

    if (modules) {
      const frontend: any = Object.entries(modules).find(([key, module]: any) => module.type === MODULE_FRONTEND_TYPE)?.[1]
      return frontend?.mybricksPrompt
    } else {
      return componentRuntime.mybricksPrompt
    }
  }

  /** 获取外壳容器 */
  getFrontendWrapper() {
    const componentRuntime = window._sandbox_.config.componentRuntime
    if (!componentRuntime) {
      return null
    }

    const modules = componentRuntime.modules

    if (modules) {
      const frontend: any = Object.entries(modules).find(([key, module]: any) => module.type === MODULE_FRONTEND_TYPE)?.[1]
      return frontend?.Wrapper
    } else {
      return componentRuntime.Wrapper
    }
  }

  /** 是否展示 PRD 文档按钮 */
  getShowPrdDocumentButton() {
    return window._sandbox_?.config?.componentRuntime?.showPrdDocumentButton !== false
  }

  /** 获取配置的版本号 */
  getVersion() {
    return window._sandbox_.config.componentRuntime?.version
  }

  getCompatibleAvailableLibraries(): CompatibleAvailableLibrary {
    return window._sandbox_.config.availableLibraries || []
  }

  getCompatibleDependencies() {
    const availableLibraries = this.getCompatibleAvailableLibraries()

    if (Array.isArray(availableLibraries)) {
      return availableLibraries.reduce((pre, cur) => {
        pre[cur.name] = {
          version: cur.version,
          readme: cur.readme,
          usage: cur.readme,
          get module() {
            return (window as any)[cur.library]
          },
          validator: cur.validator
        }
        return pre
      }, {})
    }

    return {}
  }

  getAllDependencies() {
    const base = {};

    type Libraries = {
      [key: string]: {
        version: string
        readme: string
        module: any
        validator: {
          validatePlugin: () => void
        }
      }
    }

    const compatibleAvailableLibraries = this.getCompatibleDependencies() as Libraries

    Object.entries(compatibleAvailableLibraries).forEach(([key, value]) => {
      base[key] = {
        get() {
          return value.module
        },
        enumerable: true,
        configurable: true,
      };
    })

    const componentRuntime = window._sandbox_.config.componentRuntime

    if (componentRuntime) {
      const { getDependencies, modules } = componentRuntime
      const transformDependencies = (dependencies) => {
        Object.entries(dependencies).forEach(([key, value]: any) => {
          if (value.dynamic) {
            function getDynamicModule(params) {
              return value.module(params)
            }

            getDynamicModule[DYNAMIC_MODULE] = DYNAMIC_MODULE

            base[key] = {
              get() {
                return getDynamicModule
              },
              enumerable: true,
              configurable: true,
            }
          } else {
            base[key] = {
              get() {
                return value.module
              },
              enumerable: true,
              configurable: true,
            }
          }
        })
      }

      if (typeof getDependencies === 'function') {
        transformDependencies(getDependencies({ logger: createRuntimeLogger() }))
      }

      if (modules) {
        Object.entries(modules).forEach(([key, module]: any) => {
          const { getDependencies } = module
          if (typeof getDependencies === 'function') {
            transformDependencies(getDependencies({ logger: createRuntimeLogger() }))
          }
        })
      }
    }

    if (!Object.keys(base).length) {
      [
        ['antd', antd],
        ['dayjs', dayjs],
        ['echarts-for-react', echartsForReact],
        ['antd/locale/zh_CN', zhCN]
      ].forEach(([key, module]) => {
        base[key] = {
          get() {
            return module
          },
          enumerable: true,
          configurable: true,
        }
      })
    }

    return Object.defineProperties({}, base)
  }

  /** 获取插件库名称 */
  getAddonLibraryNames({ fileName }: { fileName: string}) {
    const names: string[] = []
    const componentRuntime = window._sandbox_.config.componentRuntime

    if (componentRuntime) {
      const { getDependencies, modules } = componentRuntime
      const transformDependencies = (dependencies) => {
        names.push(...Object.keys(dependencies))
      }

      if (typeof getDependencies === 'function') {
        transformDependencies(getDependencies({ logger: createRuntimeLogger() }))
      }

      if (modules) {
        Object.entries(modules).forEach(([key, module]: any) => {
          if (fileName.startsWith(key) || (module.pattern && module.pattern.test(fileName))) {
            const { getDependencies, type } = module
            if (typeof getDependencies === 'function') {
              transformDependencies(getDependencies({ logger: createRuntimeLogger() }))
            }
            if (type === MODULE_FRONTEND_TYPE) {
              // 前端默认注入 react、react-dom
              names.push('react', 'react-dom')
            }
          }
        })
      } else {
        if (names.length) {
          names.push('react', 'react-dom')
        }
      }
    }

    if (!names.length) {
      const availableLibraries = this.getCompatibleAvailableLibraries()

      availableLibraries.forEach(({ name }) => {
        names.push(name)
      })

      if (names.length) {
        names.push('react', 'react-dom')
      }
    }

    if (!names.length) {
      return [
        'react',
        'react-dom',
        'antd',
        'dayjs',
        'echarts-for-react',
        '@ant-design/icons',
      ]
    }

    return names
  }

  getAddonValidators({ fileName }: { fileName: string}) {
    let hasLibraries = false
    const validators: any = []
    const availableLibraries = this.getCompatibleAvailableLibraries()
    if (availableLibraries.length) {
      hasLibraries = true
    }
    availableLibraries.forEach(({ validator }) => {
      if (validator) {
        validators.push(validator)
      }
    })

    const componentRuntime = window._sandbox_.config.componentRuntime

    if (componentRuntime) {
      const { getDependencies, modules } = componentRuntime
      const transformDependencies = (dependencies) => {
        const entryDependencies = Object.entries(dependencies)
        if (entryDependencies.length) {
          hasLibraries = true
        }
        entryDependencies.forEach(([_, { validator }]: any) => {
          if (validator) {
            validators.push(validator)
          }
        })
      }

      if (typeof getDependencies === 'function') {
        transformDependencies(getDependencies({ logger: createRuntimeLogger() }))
      }

      if (modules) {
        Object.entries(modules).forEach(([key, module]: any) => {
          if (fileName.startsWith(key) || (module.pattern && module.pattern.test(fileName))) {
            const { getDependencies } = module
            if (typeof getDependencies === 'function') {
              transformDependencies(getDependencies({ logger: createRuntimeLogger() }))
            }
          }
        })
      }
    }

    if (hasLibraries) {
      return validators
    }

    return null
  }

  getEffectiveLibraries() {
    const effectiveLibraries: any = []
    const availableLibraries = this.getCompatibleAvailableLibraries()
    effectiveLibraries.push(...availableLibraries);

    const componentRuntime = window._sandbox_.config.componentRuntime

    if (componentRuntime) {
      const { getDependencies, modules } = componentRuntime
      const transformDependencies = (dependencies) => {
        Object.entries(dependencies).forEach(([key, value]: any) => {
          effectiveLibraries.push({
            name: key,
            ...value
          })
        })
      }

      if (typeof getDependencies === 'function') {
        transformDependencies(getDependencies({ logger: createRuntimeLogger() }))
      }

      if (modules) {
        Object.entries(modules).forEach(([key, module]: any) => {
          const { getDependencies } = module
          if (typeof getDependencies === 'function') {
            transformDependencies(getDependencies({ logger: createRuntimeLogger() }))
          }
        })
      }
    }

    return effectiveLibraries.filter((item) => !item.excludeFromPrompt)
  }

  getOnDebug() {
    return window._sandbox_?.config?.componentRuntime?.onDebug || (() => {})
  }

  getDisallowedDebugEnvs() {
    // [TEMP] 临时兼容，后续只需从 componentRuntime 读取配置
    const disallowedDebugEnvs = (window as any)._sandbox_?.config?.componentRuntime?.disallowedDebugEnvs || (window as any)._sandbox_?.config?.disallowedDebugEnvs;

    return Array.isArray(disallowedDebugEnvs) ? disallowedDebugEnvs : [];
  }

  getDefaultDebugEnv() {
    return (window as any)._sandbox_?.config?.componentRuntime?.defaultDebugEnv
  }

  getWorkSpace() {
    return (window as any)._sandbox_?.config?.componentRuntime?.workspace
  }

  getESLint() {
    return (window as any)._sandbox_?.config?.componentRuntime?.eslint
  }

  getFrontEndDataSouce() {
    const componentRuntime = window._sandbox_.config.componentRuntime

    if (!componentRuntime) {
      return
    }

    const modules = componentRuntime.modules

    if (modules) {
      const frontend: any = Object.entries(modules).find(([key, module]: any) => module.type === MODULE_FRONTEND_TYPE)?.[1]
      return frontend?.DataSource
    } else {
      return componentRuntime?.DataSource
    }
  }
}

export default new Config()
