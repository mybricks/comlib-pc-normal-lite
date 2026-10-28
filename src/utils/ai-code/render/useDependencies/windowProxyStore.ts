import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

// 为业务代码声明全局代理对象的字段类型。
declare global {
  interface Window {
    _proxy_: { [key: string]: any }
  }
}

type ProxyKey = string | symbol

type Subscriber = {
  // 当前组件最近一次渲染读取过的顶层属性。
  dependencies: Set<ProxyKey>
  notify: () => void
}

// 所有组件共享订阅集合；activeDependencies 指向当前正在收集读取操作的组件。
const subscribers = new Set<Subscriber>()
let activeDependencies: Set<ProxyKey> | null = null
const originalValues = new Map<ProxyKey, unknown>()
let isResetting = false
let isDesignMode = true

export function setWindowProxyDesignMode(enabled: boolean): void {
  isDesignMode = enabled
}

// 保留页面上已有的数据，避免加载 store 时覆盖业务代码先前设置的值。
const existingProxy = typeof window !== 'undefined' ? window._proxy_ : undefined

if (typeof window !== 'undefined') {
  window._proxy_ = new Proxy(
    existingProxy ?? { },
    {
      // Hook 开始收集后，读取 window._proxy_.xxx 会把 xxx 记为当前组件的依赖。
      get(target, key, receiver) {
        if (!isDesignMode) return undefined
        activeDependencies?.add(key)
        return Reflect.get(target, key, receiver)
      },
      // 只通知读取过该顶层属性的组件；重复赋相同值不触发更新。
      set(target, key, value) {
        if (!isDesignMode && !isResetting) return true
        const previous = Reflect.get(target, key)
        const updated = Reflect.set(target, key, value)
        if (updated && !Object.is(previous, value)) {
          if (!isResetting && !originalValues.has(key)) originalValues.set(key, previous)
          let notified = 0
          subscribers.forEach((subscriber) => {
            if (subscriber.dependencies.has(key)) {
              notified += 1
              subscriber.notify()
            }
          })
          console.log('[windowProxyStore] update', {
            key: String(key),
            notified,
          })
        }
        return updated
      },
    },
  )
}

export function resetWindowProxy(): void {
  if (typeof window === 'undefined') return
  const values = [...originalValues]
  originalValues.clear()
  isResetting = true
  try {
    values.forEach(([key, value]) => {
      Reflect.set(window._proxy_, key, value)
    })
  } finally {
    isResetting = false
  }
}

export function useWindowProxy(): void {
  // 每个组件实例各自保存依赖、订阅者和供 React 比较的数字快照。
  const dependenciesRef = useRef<Set<ProxyKey>>(new Set())
  const subscriberRef = useRef<Subscriber | null>(null)
  const snapshotRef = useRef(0)

  // 每次渲染重新收集依赖，组件只会订阅本次渲染实际读取的字段。
  dependenciesRef.current = new Set()
  activeDependencies = dependenciesRef.current

  const subscribe = useCallback((notify: () => void) => {
    const subscriber: Subscriber = {
      dependencies: dependenciesRef.current,
      notify: () => {
        snapshotRef.current += 1
        notify()
      },
    }
    subscriberRef.current = subscriber
    subscribers.add(subscriber)
    console.log('[windowProxyStore] subscribe', {
      dependencies: [...subscriber.dependencies].map(String),
    })
    // useSyncExternalStore 会在组件卸载或重新订阅时调用此清理函数。
    return () => {
      subscribers.delete(subscriber)
      if (subscriberRef.current === subscriber) subscriberRef.current = null
    }
  }, [])

  const getSnapshot = useCallback(() => snapshotRef.current, [])
  useSyncExternalStore(subscribe, getSnapshot)

  // 提交渲染后，把本次读取结果更新到订阅者，并结束本次依赖收集。
  useLayoutEffect(() => {
    if (subscriberRef.current) {
      subscriberRef.current.dependencies = dependenciesRef.current
    }
    if (activeDependencies === dependenciesRef.current) {
      activeDependencies = null
    }
  })
}

