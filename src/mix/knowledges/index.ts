/** antd所有组件知识库 */
export const ANTD_KNOWLEDGES_MAP: Record<string, string> = (function () {
  const markdowns = require.context('./antd', false, /\.ts$/);
  return markdowns.keys().reduce((modules, name) => {
    // 获取模块名
    const moduleName = name.replace(/^\.\/(.*)\.\w+$/, '$1')
    // 导入模块
    modules[moduleName.toUpperCase()] = markdowns(name).default
    return modules
  }, {})
})()

/** echarts所有组件知识库 */
export const ECHARTS_KNOWLEDGES_MAP: Record<string, string> = (function () {
  const markdowns = require.context('./echarts', false, /\.ts$/);
  return markdowns.keys().reduce((modules, name) => {
    // 获取模块名
    const moduleName = name.replace(/^\.\/(.*)\.\w+$/, '$1')
    // 导入模块
    modules[moduleName] = markdowns(name).default
    return modules
  }, {})
})()

/** dndkit知识库 */
export const DNDKIT_KNOWLEDGES_MAP: Record<string, string> = (function () {
  const markdowns = require.context('./dndkit', false, /\.ts$/);
  return markdowns.keys().reduce((modules, name) => {
    // 获取模块名
    const moduleName = name.replace(/^\.\/(.*)\.\w+$/, '$1')
    // 导入模块
    modules[moduleName.toUpperCase()] = markdowns(name).default
    return modules
  }, {})
})()

export const ANTD_ICONS_KNOWLEDGES_MAP = new Proxy({}, {
  get() {
    return {
      editors: {
        ":root": {
          style: [
            {
              items: [
                {
                  title: '样式',
                  options: ['font']
                }
              ]
            }
          ]
        }
      }
    }
  }
})