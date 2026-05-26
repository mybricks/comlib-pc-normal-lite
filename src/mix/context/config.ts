import * as antd from "antd";
import echartsForReact from '../../utils/echarts-for-react'
import zhCN from 'antd/locale/zh_CN'

const DEFAULT_ENTRY_FILE = 'index'
const MODULE_FRONTEND_TYPE = 'frontend'

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
          base[key] = {
            get() {
              return value.module
            },
            enumerable: true,
            configurable: true,
          }
        })
      }

      if (typeof getDependencies === 'function') {
        transformDependencies(getDependencies())
      }

      if (modules) {
        Object.entries(modules).forEach(([key, module]: any) => {
          const { getDependencies } = module
          if (typeof getDependencies === 'function') {
            transformDependencies(getDependencies())
          }
        })
      }
    }

    if (!Object.keys(base).length) {
      [
        ['antd', antd],
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
    const availableLibraries = this.getCompatibleAvailableLibraries()

    availableLibraries.forEach(({ name }) => {
      names.push(name)
    })

    const componentRuntime = window._sandbox_.config.componentRuntime

    if (componentRuntime) {
      const { getDependencies, modules } = componentRuntime
      const transformDependencies = (dependencies) => {
        names.push(...Object.keys(dependencies))
      }

      if (typeof getDependencies === 'function') {
        transformDependencies(getDependencies())
      }

      if (modules) {
        Object.entries(modules).forEach(([key, module]: any) => {
          if (fileName.startsWith(key)) {
            const { getDependencies } = module
            if (typeof getDependencies === 'function') {
              transformDependencies(getDependencies())
            }
          }
        })
      }
    }

    if (!names.length) {
      return [
        'antd',
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
        transformDependencies(getDependencies())
      }

      if (modules) {
        Object.entries(modules).forEach(([key, module]: any) => {
          if (fileName.startsWith(key)) {
            const { getDependencies } = module
            if (typeof getDependencies === 'function') {
              transformDependencies(getDependencies())
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
        transformDependencies(getDependencies())
      }

      if (modules) {
        Object.entries(modules).forEach(([key, module]: any) => {
          const { getDependencies } = module
          if (typeof getDependencies === 'function') {
            transformDependencies(getDependencies())
          }
        })
      }
    }

    return effectiveLibraries
  }
}

export default new Config()
