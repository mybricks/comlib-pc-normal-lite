class Card {
  /** cardId -> (slotKey -> apis) */
  _map: Map<string, Map<string, any>> = new Map();

  register(id: string, slotKey: string, apis: any) {
    if (!this._map.has(id)) {
      this._map.set(id, new Map());
    }
    this._map.get(id)!.set(slotKey, apis);
  }

  unregister(id: string, slotKey: string) {
    const slots = this._map.get(id);
    if (slots) {
      slots.delete(slotKey);
      if (slots.size === 0) {
        this._map.delete(id);
      }
    }
  }

  /** 合并同一 cardId 下所有 slot 的 apis，同名 API 以后注册的为准 */
  getMergedApis(id: string): Record<string, any> | null {
    const slots = this._map.get(id);
    if (!slots || slots.size === 0) return null;
    const merged: Record<string, any> = {};
    for (const apis of slots.values()) {
      for (const [key, fn] of Object.entries(apis)) {
        merged[key] = fn;
      }
    }
    return merged;
  }

  callApis(id: string, apiNames: string[]) {
    const merged = this.getMergedApis(id);
    const results: Record<string, any> = {};
    if (merged) {
      apiNames.forEach((api) => {
        const handler = merged[api];
        if (!handler) {
          results[api] = `[error] API "${api}" 不存在于卡片 "${id}" 中`;
        } else {
          try {
            results[api] = handler();
          } catch (err) {
            results[api] = `[error] ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      });
    } else {
      results['_error'] = `卡片 "${id}" 不存在`;
    }
    return results;
  }
}

export default new Card();
