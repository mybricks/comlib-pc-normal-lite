import { useMemo } from 'react'
import { createMyBricksTesting } from './mybricks-testing'
import type { MyBricksTesting } from './mybricks-testing'
import { EmptyDataSource } from '../../types'
import type { Dependencies, DataSource } from '../../types'

interface Params {
  dependencies: Dependencies
  DataSource: DataSource
}
const useDependencies = (params: Params) => {
  return useMemo(() => {
    const BaseDataSource = params.DataSource || EmptyDataSource;
    
    class DataSourceWithProxy extends BaseDataSource {
      constructor() {
        super();
        return new Proxy(this, {
          get(target, key: string) {
            const val = (target as any)[key]
            if (typeof val === 'function' && key !== 'constructor') {
              return (...args: any[]) => {
                const result = val.apply(target, args);
                // [TODO] 日志收集
                console.log('[DataSourceWithProxy]', { type: 'dataSource', method: key, args, result })
                // collectDebugLogs({ type: 'dataSource', method: key, args, result });
                return result
              }
            }
            return val
          }
        })
      }
    }

    const mybricksTesting = createMyBricksTesting();
    
    const dependencies: Dependencies = {
      ...params.dependencies,
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
  }, []);
}

export { useDependencies }
