/**
 * mybricks/testing — 内置测试框架
 *
 * 提供 describe / spyOn 两个 API，用于在 setup.js 中声明多套运行环境。
 * describe 回调惰性执行（不立即运行），框架在 activate 时才真正执行。
 * 框架在设计态自动激活 label='mock' 的环境，运行时自动激活 label='prod' 的环境。
 *
 * 使用方式（setup.js）：
 *   import { describe, spyOn } from 'mybricks/testing'
 *   import dataSource from 'dataSource'
 *
 *   describe('mock', () => {
 *     spyOn(dataSource, 'getUser').mockReturn({ status: 200, data: { name: '张三' } })
 *   })
 *
 *   describe('prod', () => {
 *     dataSource.axios.defaults.baseURL = 'https://api.prod.com'
 *   })
 */

export interface SpyChain {
  /** 替换该方法的返回值（异步方法返回 Promise.resolve(value)，同步方法直接返回 value） */
  mockReturn(value: any): void;
  /** 恢复原始方法 */
  mockRestore(): void;
}

export type DescribeFn = () => void;

/** 每次 createEnvRunner 调用创建一个独立的 EnvRunner，供单次 eval 使用 */
export interface EnvRunner {
  describe(name: string, fn: DescribeFn): void;
  spyOn(target: any, method: string): SpyChain;
  /** 激活指定环境（执行其回调），并在激活前 restore 上次的 spy */
  activate(name: string): void;
  /** 获取已注册的所有环境名 */
  getEnvNames(): string[];
}

/**
 * 创建一个独立的 EnvRunner 实例。
 * 每次 eval setup.js 前调用，天然隔离、无跨 eval 状态污染。
 */
export function createEnvRunner(collectDebugLogs?: (entry: { type: string; method: string; args: any[]; result?: any }) => void): EnvRunner {
  /** 各 describe 存储的回调（惰性，activate 时才执行） */
  const registry: Record<string, DescribeFn> = {};

  /** 已被 spyOn 替换的方法，用于 restore */
  const spiedMethods: Array<{ target: any; method: string; original: any }> = [];

  function restoreAll() {
    for (const { target, method, original } of spiedMethods) {
      target[method] = original;
    }
    spiedMethods.length = 0;
  }

  function describe(name: string, fn: DescribeFn) {
    // 只存储回调，不立即执行
    registry[name] = fn;
  }

  function spyOn(target: any, method: string): SpyChain {
    if (!target || typeof target[method] === 'undefined') {
      return {
        mockReturn: () => {},
        mockRestore: () => {},
      };
    }
    const original = target[method];

    return {
      mockReturn(value: any) {
        spiedMethods.push({ target, method, original });
        target[method] = (...callArgs: any[]) => {
          collectDebugLogs?.({ type: 'spyOn', method, args: callArgs, result: value });
          return Promise.resolve(value);
        };
      },
      mockRestore() {
        target[method] = original;
        const idx = spiedMethods.findIndex((s) => s.target === target && s.method === method);
        if (idx !== -1) spiedMethods.splice(idx, 1);
      },
    };
  }

  function activate(name: string) {
    restoreAll();
    collectDebugLogs?.({ type: 'envActivate', method: 'activate', args: [name] });
    const fn = registry[name];
    if (!fn) {
      // console.warn(`[mybricks/testing] Environment "${name}" not found.`);
      return;
    }
    fn();
  }

  function getEnvNames() {
    return Object.keys(registry);
  }

  return { describe, spyOn, activate, getEnvNames };
}
