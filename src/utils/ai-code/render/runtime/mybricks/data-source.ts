/**
 * DataSource 基类
 * 每个实例拥有独立的 axios 实例，可通过 this.axios.defaults 修改 baseURL / headers。
 * spyOn 直接替换实例上的方法属性，无需 Proxy。
 *
 * VSCode 环境代理（参考 1.js createEnvs / createAPI 模式）：
 *   1. 首次请求时通过 vsCodeMessage.call('debug', { proxy }) 向宿主注册反向代理，获取本地调试端口
 *   2. 后续所有请求通过 vsCodeMessage.call('httpRequest', { url: http://localhost:{port}/api{path} })
 *      由宿主转发，绕过 WebView 的跨域和网络限制
 *
 * 【注意】baseURL 由用户在 setup.js 中通过 this.axios.defaults.baseURL = '...' 设置，
 * 所以 debug 注册在首次请求时懒加载，而不是在构造器里立即调用。
 */
export class DataSource {
  /** 每个实例独立的 axios 实例 */
  axios: any;

  constructor() {
    const axiosLib = typeof window !== 'undefined' ? (window as any).axios : undefined;
    const vsCodeMessage = typeof window !== 'undefined' ? (window as any).webViewMessageApi : undefined;

    if (vsCodeMessage) {
      // VSCode 环境：不走 axios，直接通过 vsCodeMessage 代理请求
      // debugPort 在首次请求时懒加载注册（此时 baseURL 已被 setup.js 设置完毕）
      let debugPort: number | null = null;
      let debugPortPromise: Promise<number> | null = null;

      // 对 this 的引用，用于在 getDebugPort 中读取 setup.js 设置的 baseURL
      const self = this;

      const getDebugPort = (): Promise<number> => {
        if (debugPort !== null) return Promise.resolve(debugPort);
        if (debugPortPromise) return debugPortPromise;
        // 此时 setup.js 已经执行，baseURL 已设置
        const baseUrl = self.axios?.defaults?.baseURL || '';
        debugPortPromise = vsCodeMessage.call('debug', {
          proxy: {
            '/api': { target: baseUrl, changeOrigin: true },
          },
        }).then((res: any) => {
          debugPort = res.port;
          return debugPort as number;
        });
        return debugPortPromise!;
      };

      const makeRequest = (method: string) => (url: string, dataOrConfig?: any, config?: any) => {
        const isBodyless = method === 'GET' || method === 'DELETE';
        const cfg = isBodyless ? (dataOrConfig ?? {}) : (config ?? {});
        const body = isBodyless ? undefined : dataOrConfig;

        // 绝对 URL（带域名）：直接透传给 httpRequest，由 VSCode extension host 转发
        if (/^https?:\/\//.test(url)) {
          return vsCodeMessage.call('httpRequest', {
            method,
            url,
            headers: cfg.headers,
            data: body ?? cfg.data,
            params: cfg.params,
          })
        }

        // 相对路径：确保路径以 /api 开头，通过代理端口转发
        const path = url.startsWith('/api') ? url : `/api${url.startsWith('/') ? url : `/${url}`}`;

        return getDebugPort().then((port) => {
          return vsCodeMessage.call('httpRequest', {
            method,
            url: `http://localhost:${port}${path}`,
            headers: cfg.headers,
            data: body ?? cfg.data,
            params: cfg.params,
          });
        });
      };

      this.axios = {
        defaults: { baseURL: '', headers: { common: {} } },
        get: makeRequest('GET'),
        post: makeRequest('POST'),
        put: makeRequest('PUT'),
        delete: makeRequest('DELETE'),
        patch: makeRequest('PATCH'),
      };
    } else if (window['__IS_AICODE__']) {
      const makeRequest = (method: string) => (url: string, dataOrConfig?: any, config?: any) => {
        const isBodyless = method === 'GET' || method === 'DELETE';
        const cfg = isBodyless ? (dataOrConfig ?? {}) : (config ?? {});
        const body = isBodyless ? undefined : dataOrConfig;
        const { baseURL, headers } = this.axios.defaults

        return window['__IS_AICODE__'].requestProxy
          .request({
            method,
            url,
            headers: cfg.headers,
            data: body ?? cfg.data,
            params: cfg.params,
          }, {
            proxyHost: baseURL || undefined,
            proxyHeaders: headers,
          })
      }

      this.axios = {
        defaults: { baseURL: '', headers: { common: {} } },
        get: makeRequest('GET'),
        post: makeRequest('POST'),
        put: makeRequest('PUT'),
        delete: makeRequest('DELETE'),
        patch: makeRequest('PATCH'),
      };
    } else {
      const axios = axiosLib?.create?.({
        baseURL: ''
      })

      if (axios) {
        this.axios = axios
        this.axios.interceptors.request.use((config: any) => {
          if (config.headers) {
            delete config.headers['cookie'];
            delete config.headers['Cookie'];
          }
          return config;
        });
      } else {
        const makeRequest = (method: string) => {
          return () => {
            return Promise.reject(new Error('axios not available'))
          }
        }
        this.axios = {
          get: makeRequest('GET'),
          post: makeRequest('POST'),
          put: makeRequest('PUT'),
          delete: makeRequest('DELETE'),
          patch: makeRequest('PATCH'),
          defaults: { baseURL: '', headers: { common: {} } },
        };
      }
    }
  }
}
