import React, {useRef} from 'react'
import * as antd from "antd";
import {genAIRuntime} from './../utils/ai-code'
import echartsForReact from './../utils/echarts-for-react'
import {StyleProvider} from '@ant-design/cssinjs'
import {ConfigProvider} from "antd";
import zhCN from 'antd/locale/zh_CN'
import context from './context'

const SUPPORTED_LOGS = {
  log: true,
  info: true,
  error: true,
  warn: true,
}

export default genAIRuntime({
  title: 'AI',
  examples: [
    '创建一个后台数据看板，包含四个关键指标数据卡片，月度销售额趋势折线图，用户分布饼图',
    '生成一个标准的商品管理列表页，顶部提供搜索表单，下方是商品数据表格，包含查看和删除操作',
    '制作一个包含分步表单的注册页面',
    '实现一个企业通讯录页面，左侧是部门组织架构树，右侧是该部门下的员工详情列表，右上角提供添加员工按钮',
  ],
  dependencies: (() => {
    const base = {
      antd,
      'echarts-for-react': echartsForReact,
      'antd/locale/zh_CN': zhCN,
      // '@dnd-kit/core': dndCore,
      // '@dnd-kit/modifiers': dndModifiers,
      // '@dnd-kit/sortable': dndSortable,
      // '@dnd-kit/utilities': dndUtilities
    };

    const builtinDefs: PropertyDescriptorMap = {
      '@antv/g6': {
        get() { return (window as any).G6 },
        enumerable: true,
        configurable: true,
      },
    };

    // projectConfig.avaliableLibraries 中的库通过 library 全局变量名从 window 获取
    const projectLibs = context.projectConfig?.avaliableLibraries ?? [];
    const projectDefs: PropertyDescriptorMap = {};
    for (const lib of projectLibs) {
      if (lib.name && lib.library && !(lib.name in base) && !(lib.name in builtinDefs)) {
        const globalVar = lib.library;
        projectDefs[lib.name] = {
          get() { return (window as any)[globalVar] },
          enumerable: true,
          configurable: true,
        };
      }
    }

    return Object.defineProperties(base, { ...builtinDefs, ...projectDefs });
  })(),
  wrapper: ({ children, env, canvasContainer }) => {
    // const container = useRef(
    //   env.edit || env.runtime.debug
    //     ? document.querySelector('#_mybricks-geo-webview_')!.shadowRoot
    //     : null
    // )
    return (
      <StyleProvider
        // container={container.current!}
        container={canvasContainer}
        hashPriority="high"
      >
        <ConfigProvider getPopupContainer={() => canvasContainer}>
          {children}
        </ConfigProvider>
      </StyleProvider>
    )
  },
  logger: ({ id, mode }) => {
    if (mode === "runtime") {
      return new Proxy({}, {
        get(_, prop: string) {
          return (...args) => {
            if (SUPPORTED_LOGS[prop]) {
              context.pushLog(id, prop as any, args);
            }
          }
        }
      })
    } else {
      return new Proxy({}, {
        get(_, key) {
          return console[key] || (() => {})
        }
      })
    }
  }
})
