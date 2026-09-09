import { Comment } from './comment'
import { Version } from './version'



class Context {
  version = new Version()
  comment = new Comment()
}

let context: Context | null = null

function createContext(): Context {
  const instance = new Context()
  if (typeof window !== 'undefined') {
    ;(window as any)._context_ = instance
  }
  return instance
}

function getContext(): Context {
  if (!context) {
    context = createContext()
  }
  return context
}

const contextProxy = new Proxy({} as Context, {
  get(_target, prop, receiver) {
    return Reflect.get(getContext(), prop, receiver)
  },
  set(_target, prop, value, receiver) {
    return Reflect.set(getContext(), prop, value, receiver)
  },
  has(_target, prop) {
    return prop in getContext()
  },
  ownKeys() {
    return Reflect.ownKeys(getContext())
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(getContext(), prop)
  },
})

export default contextProxy
