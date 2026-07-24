import { useMemo } from 'react'
import { createMyBricksTesting } from './mybricks-testing'
import type { MyBricksTesting } from './mybricks-testing'
import { createMyBricks } from '../mybricks'
import createMyBricksForKdsWeb from '../mybricks/kds-web'
import createMyBricksForGuiCardNext from '../mybricks/gui-card-next'
import context, { config } from '../../../../mix/context'
import { DYNAMIC_MODULE } from '../../../../mix/context/config'

class EmptyDataSource {
  constructor(params) {}
}

/** 注入的外部依赖库(如 dayjs、antd 等) */
type Dependencies = Record<string, any>
type DataSource = typeof EmptyDataSource

interface Params {
  dependencies: Dependencies
  DataSource: DataSource
  id: string
  env: any
  data: any
  activeEnv: string
  runtimeMode: any
  logger: any
  reload: any
}
const useDependencies = (params: Params) => {

  // [TODO]
  const reload = params.activeEnv + "_" + params.reload

  return useMemo(() => {
    const frontEndDataSouce = config.getFrontEndDataSouce()
    const BaseDataSource = frontEndDataSouce || params.DataSource || EmptyDataSource;
    
    class DataSourceWithProxy extends BaseDataSource {
      constructor(params) {
        super({...params, pushLog: (method, data) => context.pushLog(method, data)});
        return new Proxy(this, {
          get(target, key: string) {
            if (key === 'axios') {
              return target[key]
            }
            const val = (target as any)[key]
            if (typeof val === 'function' && key !== 'constructor') {
              return (...args: any[]) => {
                const result = val.apply(target, args);
                // [TODO] 日志收集
                // collectDebugLogs({ type: 'dataSource', method: key, args, result });
                return result
              }
            }
            return val
          }
        })
      }
    }

    const { id, env, data, activeEnv, runtimeMode, logger } = params;
    const frontendMode = config.getFrontendMode()
    const createMyBricksProps = { comId: id, runtimeMode, logger, env, data }
    let mybricks: any = {}

    if (frontendMode === 'kds_web') {
      mybricks = createMyBricksForKdsWeb(createMyBricksProps)
    } else if (frontendMode === 'gui_card') {
      mybricks = createMyBricksForGuiCardNext(createMyBricksProps)
    } else {
      mybricks = createMyBricks(createMyBricksProps);
    }

    /**
     * 'mybricks/testing' 支持多实例：每个文件（setup.ts）require 时各自获得独立的 EnvRunner，
     * 避免多个 setup 文件共用同一 registry / spiedMethods 造成冲突。
     * DYNAMIC_MODULE 标记让 fileSystem 在每次 require('mybricks/testing') 时调用此工厂函数，
     * 传入 { id: filename, logger }，从而为每个文件创建隔离的实例。
     */
    function createMyBricksTestingModule(_params: { id: string; logger: any }) {
      return createMyBricksTesting({ env, data, activeEnv });
    }
    (createMyBricksTestingModule as any)[DYNAMIC_MODULE] = DYNAMIC_MODULE;

    const customDependencies = window._sandbox_.config.componentRuntime?.getDependencies?.({ mybricks }) || {}
    
    const dependencies: Dependencies = {
      ...params.dependencies,
      ...Object.entries(customDependencies).reduce((pre, [key, value]: any) => {
        pre[key] = value.module
        return pre;
      }, {}),
      'mybricks': mybricks,
      'mybricks/testing': createMyBricksTestingModule
    }

    if (!dependencies.mybricks) {
      dependencies.mybricks = {}
    }

    if (frontendMode === 'prototype') {
      dependencies._css = {
        set() {},
        remove() {},
      }
    } else {
      dependencies._css = {
        set(filename, css) {
          const STYLE_REPLACE_ID = '__mybricks_ai_module_id__';
          // 替换编译时注入的值，使用where防止提升权重
          const myContent = css.replaceAll(`.${STYLE_REPLACE_ID}`, `:where(.${id})`)
            .replace(/:where\(\.[^)]+\)\s*(:root\b)/g, ':host') // 引擎shadowdom内oot替换为:host
          // 组件id + 文件路径，保证唯一性
          env.canvas.css.set(`${id}_${filename}`.replace(/\./g, '__').replace(/\//g, '_'), myContent)
        },
        remove() {
          env.canvas.css.remove(id)
        }
      }
    }

    dependencies.mybricks.DataSource = DataSourceWithProxy
    
    return dependencies as {
      ['mybricks/testing']: MyBricksTesting
      [key: string]: any
    };
  }, [reload]);
}

export { useDependencies }
