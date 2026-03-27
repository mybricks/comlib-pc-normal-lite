/**
 * DataSource 基类
 * 每个实例拥有独立的 axios 实例，可通过 this.axios.defaults 修改 baseURL / headers。
 * spyOn 直接替换实例上的方法属性，无需 Proxy。
 */
export class DataSource {
  /** 每个实例独立的 axios 实例 */
  axios: any;

  constructor() {
    const axiosLib = typeof window !== 'undefined' ? (window as any).axios : undefined;
    this.axios = axiosLib?.create?.() ?? {
      get: () => Promise.reject(new Error('axios not available')),
      post: () => Promise.reject(new Error('axios not available')),
      defaults: { baseURL: '', headers: { common: {} } },
    };
  }
}
