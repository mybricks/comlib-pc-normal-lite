export function deepClone<T>(source: T, cache = new WeakMap<object, unknown>()): T {
  if (source === null || typeof source !== "object") {
    return source;
  }
  if (cache.has(source as object)) {
    return cache.get(source as object) as T;
  }
  if (Array.isArray(source)) {
    const arr: unknown[] = [];
    cache.set(source as object, arr);
    for (let i = 0; i < source.length; i++) {
      arr[i] = deepClone(source[i], cache);
    }
    return arr as T;
  }
  const obj = {} as T;
  cache.set(source as object, obj);
  for (const key of Object.keys(source as object)) {
    (obj as Record<string, unknown>)[key] = deepClone(
      (source as Record<string, unknown>)[key],
      cache
    );
  }
  return obj;
}
