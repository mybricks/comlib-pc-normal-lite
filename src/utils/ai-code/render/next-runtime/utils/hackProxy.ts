const PROXY_MARKER = Symbol('hackProxy');

const hackProxy = () => {
  const proxy = new Proxy(() => {}, {
    get(_, key) {
      if (key === PROXY_MARKER) {
        return true
      }
      return proxy
    },
    apply(_target, _thisArg, _args) {
      return proxy
    }
  })
  return proxy
}

export { hackProxy, PROXY_MARKER }
