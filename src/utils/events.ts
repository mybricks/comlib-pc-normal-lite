type Handle<T> = (params: T) => void;

const EMPTY_CACHE = Symbol("EMPTY_CACHE");

class Events<TMap extends object> {
  private events = new Map<
    keyof TMap,
    {
      cache: typeof EMPTY_CACHE | TMap[keyof TMap];
      handles: Set<Handle<TMap[keyof TMap]>>;
    }
  >();

  /** 获取event，不存在默认创建 */
  getEvent<K extends keyof TMap>(key: K) {
    let event = this.events.get(key);
    if (!event) {
      this.events.set(
        key,
        (event = { cache: EMPTY_CACHE, handles: new Set() }),
      );
    }
    return event;
  }

  /** 注册 */
  on<K extends keyof TMap>(
    key: K,
    handle: Handle<TMap[K]>,
    immediate: boolean = true,
  ) {
    const event = this.getEvent(key);
    if (immediate && event.cache !== EMPTY_CACHE) {
      handle(event.cache as TMap[K]);
    }
    event.handles.add(handle as Handle<TMap[keyof TMap]>);

    return () => {
      this.off(key, handle);
    };
  }

  off<K extends keyof TMap>(key: K, handle: Handle<TMap[K]>) {
    this.getEvent(key).handles.delete(handle as Handle<TMap[keyof TMap]>);
  }

  emit<K extends keyof TMap>(key: K, value: TMap[K]) {
    const event = this.getEvent(key);
    event.cache = value;
    event.handles.forEach((handle) => handle(value));
  }
}

export { Events };
