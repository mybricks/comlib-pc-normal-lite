class Card {
  _map: Map<string, any> = new Map();

  register(id, options) {
    this._map.set(id, options);
  }

  unregister(id) {
    this._map.delete(id);
  }

  get(id) {
    return this._map.get(id);
  }

  callApis(id, apiNames) {
    const card = this.get(id)
    const results = {}
    if (card) {
      apiNames.forEach((api) => {
        const handler = card[api]
        if (!handler) {
          results[api] = `[error] API "${name}" 不存在于卡片 "${id}" 中`
        } else {
          try {
            results[api] = handler()
          } catch (err) {
            results[api] = `[error] ${err instanceof Error ? err.message : String(err)}`
          }
        }
      })
    } else {
      results['_error'] = `卡片 "${id}" 不存在`
    }
    return results
  }
}

export default new Card();
