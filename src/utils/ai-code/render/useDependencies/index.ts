import { useMemo } from 'react'
import { createMyBricksTesting } from './mybricks-testing'
import type { MyBricksTesting } from './mybricks-testing'
import { createMyBricks } from '../mybricks'

class EmptyDataSource {}

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
    const BaseDataSource = params.DataSource || EmptyDataSource;
    
    class DataSourceWithProxy extends BaseDataSource {
      constructor() {
        super();
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
    const mybricks = createMyBricks({ comId: id, runtimeMode, logger, env, data });
    const mybricksTesting = createMyBricksTesting({
      env,
      data,
      activeEnv,
    });
    const customDependencies = window._sandbox_.config.componentRuntime?.getDependencies?.({ mybricks }) || {}
    
    const dependencies: Dependencies = {
      ...params.dependencies,
      ...Object.entries(customDependencies).reduce((pre, [key, value]: any) => {
        pre[key] = value.module
        return pre;
      }, {}),
      'mybricks': mybricks,
      'mybricks/testing': mybricksTesting
    }

    if (!dependencies.mybricks) {
      dependencies.mybricks = {}
    }

    dependencies.mybricks.DataSource = DataSourceWithProxy

    return dependencies as {
      ['mybricks/testing']: MyBricksTesting
      [key: string]: any
    };
  }, [reload]);
}

export { useDependencies }
