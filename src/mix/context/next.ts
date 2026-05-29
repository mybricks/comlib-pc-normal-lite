import { Events } from "../../utils/events";

class Context {
  /** 组件 */
  component: {
    /** 数据源、各类api */
    params: any
    /** 通知引擎更新doc、上下锁 */
    actions: {
      notifyChanged: (...params: any) => void
    }
    /** 事件 */
    events: Events<{
      /** 调试相关数据 */
      'debugTarget': any
      /** 文件变更 */
      'fileChange': any
      /** 运行时错误 */
      'runtimeError': Error | null
      /** 编译错误 */
      'compileError': any[]
      /** vibing状态 */
      'vibing': boolean
    }>;
  } | null = null

  /** 设置组件 */
  setComponent({ params, actions }) {
    /**
     * [TODO] 这里观察下是不是设置一次就行了？
     * 多次调用，且actions可能是空对象
     */
    if (Object.keys(actions).length) {
      if (!this.component) {
        this.component = {
          params,
          actions,
          events: new Events()
        }
      } else {
        this.component.params = params
        this.component.actions = actions
      }
    }
  }

  /** 通知引擎文档相关更新 */
  notifyChanged(filename?: string, changeType?: 'delete' | 'update', value?: any) {
    if (!filename) {
      this.component?.actions?.notifyChanged?.();
    } else {
      this.component?.actions?.notifyChanged?.(filename, changeType, value);
    }
  }
}

const nextContext = new Context()

export default nextContext
