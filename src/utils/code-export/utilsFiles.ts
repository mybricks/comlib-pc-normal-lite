const api = {
  path: 'api.js',
  content: `const envInstances = {};
let currentEnvKey = null;

const getCurrentInstance = () => {
  if (currentEnvKey && envInstances[currentEnvKey]) {
    return envInstances[currentEnvKey];
  }
  const keys = Object.keys(envInstances);
  if (keys.length > 0) {
    return envInstances[keys[0]];
  }

  return (config) => {
    const { method = 'GET', url, params, data: body, headers } = config;
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetch(\`\${url}\${query}\`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());
  };
}

const createAPI = (defaultConfig, paramsMapper) => {
  return (params) => {
    const runtimeConfig = paramsMapper ? paramsMapper(params) : {};
    return getCurrentInstance()({ ...defaultConfig, ...runtimeConfig });
  };
}

const createEnvs = (envConfigs) => {
  const axiosLib = typeof window !== 'undefined' ? window.axios ?? null : null;
  Object.entries(envConfigs).forEach(([key, { title: _title, baseUrl, ...rest }]) => {
    if (axiosLib) {
      const axiosInstance = axiosLib.create({ baseURL: baseUrl, ...rest });
      envInstances[key] = (config) =>
        axiosInstance(config).then((res) => res?.data ?? res);
    } else {
      envInstances[key] = (config) => {
        const { method = 'GET', url: path = '', params, data: reqBody, headers: reqHeaders } = config;
        const fullUrl = baseUrl.replace(/\\/$/, '') + path;
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return fetch(\`\${fullUrl}\${query}\`, {
          method,
          headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}), ...reqHeaders },
          body: reqBody != null ? JSON.stringify(reqBody) : undefined,
        }).then((r) => r.json());
      };
    }
    if (currentEnvKey === null) currentEnvKey = key;
  });
}

export { createAPI, createEnvs }
`
}

const index = {
  path: 'index.jsx',
  content: `export * from './router'
export * from './refs'
export * from './api'`
}

const refs = {
  path: 'refs.jsx',
  content: `import { BrowserRouter } from 'react-router-dom'
import { useStore } from './store'

const appRef = (Component) => {
  return (props) => {
    const { store } = useStore()

    return (
      <BrowserRouter>
        <Component {...props} store={store}/>
      </BrowserRouter>
    )
  }
}

const comRef = (Component) => {
  return (props) => {
    const { store } = useStore()
    return <Component {...props} store={store}/>
  }
}

const pageRef = (Component) => {
  return (props) => {
    const { store } = useStore()
    return <Component {...props} store={store}/>
  }
}

export { appRef, comRef, pageRef }
`
}

const router = {
  path: 'router.js',
  content: `import { Routes, Route } from 'react-router-dom'

export { Routes, Route }
`
}

const store = {
  path: 'store.js',
  content: `import { useRef, useSyncExternalStore } from 'react'
import Store from '../store'

const SYMBOL_SETLISTENER = Symbol('setListener')
const SYMBOL_SUBSCRIBE = Symbol('subscribe')
const SYMBOL_GETSNAPSHOT = Symbol('getSnapshot')
class DefaultStore {}

const genListenersStore = (StoreClass) => {
  const listenersMap = new Map()
  let store
  try {
    store = StoreClass ? new StoreClass() : new DefaultStore()
  } catch (error) {
    store = new DefaultStore()
    console.error('store创建失败：', error)
  }
  const setListener = (key, listener) => {
    let listeners = listenersMap.get(key)
    if (!listeners) {
      listeners = new Set()
      listenersMap.set(key, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === SYMBOL_SETLISTENER) {
          return setListener
        }
        const value = store[key]
        if (typeof value === 'function') {
          return value.bind(
            new Proxy(
              {},
              {
                get(_, k) {
                  return store[k]
                },
                set(_, k, v) {
                  store[k] = v
                  const list = listenersMap.get(k)
                  if (list) {
                    list.forEach((fn) =>
                      fn({ key: k, value: v })
                    )
                  }
                  return true
                },
              }
            )
          )
        }
        return store[key]
      },
    }
  )
}

const createReactiveStore = (store) => {
  let state = {}
  const collectionsListener = new Map()
  const listeners = new Set()
  const subscribe = (callback) => {
    listeners.add(callback)
    return () => {
      // collectionsListener.forEach((destroy) => destroy())
      // collectionsListener.clear()
      console.log("销毁")
      listeners.delete(callback)
    }
  }
  const getSnapshot = () => state

  return new Proxy({}, {
    get(_target, key) {
      if (key === SYMBOL_SUBSCRIBE) return subscribe
      if (key === SYMBOL_GETSNAPSHOT) return getSnapshot
      const value = store[key]
      console.log("注册", key, collectionsListener.has(key))
      if (!collectionsListener.has(key)) {
        const collectionListener = ({ key: k, value: v }) => {
          state = {
            ...state,
            [k]: v
          }
          listeners.forEach((listener) => listener())
        }
        collectionsListener.set(
          key,
          store[SYMBOL_SETLISTENER](key, collectionListener)
        )
      }
      return value
    },
  })
}

const store = genListenersStore(Store)

const useStore = () => {
  const autoStore = useRef(null)
  if (!autoStore.current) {
    autoStore.current = createReactiveStore(store)
  }
  const state = useSyncExternalStore(
    autoStore.current[SYMBOL_SUBSCRIBE],
    autoStore.current[SYMBOL_GETSNAPSHOT]
  )

  return {
    store: autoStore.current,
    state,
  }
}

export { useStore }
`
}

export default [api, index, refs, router, store]
