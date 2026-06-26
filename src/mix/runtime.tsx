import React, {useRef} from 'react'
import * as antd from "antd";
import {genAIRuntime} from './../utils/ai-code'
import echartsForReact from './../utils/echarts-for-react'
import {StyleProvider} from '@ant-design/cssinjs'
import {ConfigProvider} from "antd";
import zhCN from 'antd/locale/zh_CN'
import context, { config } from './context'
import {
  isLoggerMethod,
  mergeLoggerBindings,
  type LoggerBindings,
} from '../utils/ai-code/render/logger'

function createRuntimeLogger(mode: string, bindings: LoggerBindings = {}) {
  return new Proxy({}, {
    get(_, prop: string | symbol) {
      if (prop === 'child') {
        return (nextBindings?: LoggerBindings | string) => createRuntimeLogger(mode, mergeLoggerBindings(bindings, nextBindings));
      }

      if (!isLoggerMethod(prop)) {
        return () => {};
      }

      return (...args: any[]) => {
        if (mode === 'runtime' || mode.includes('_runtime_')) {
          context.pushLog(prop, args, { bindings });
        }
      };
    }
  });
}

export default genAIRuntime({
  title: 'AI',
  examples: [
    '创建一个后台数据看板，包含四个关键指标数据卡片，月度销售额趋势折线图，用户分布饼图',
    '生成一个标准的商品管理列表页，顶部提供搜索表单，下方是商品数据表格，包含查看和删除操作',
    '制作一个包含分步表单的注册页面',
    '实现一个企业通讯录页面，左侧是部门组织架构树，右侧是该部门下的员工详情列表，右上角提供添加员工按钮',
  ],
  getDependencies: () => {
    return config.getAllDependencies()
  },
  wrapper: ({ children, env, canvasContainer }) => {
    return (
      <StyleProvider
        container={canvasContainer}
        hashPriority="high"
      >
        <ConfigProvider getPopupContainer={() => canvasContainer}>
          {children}
        </ConfigProvider>
      </StyleProvider>
    )
  },
  logger: ({ id, mode }) => createRuntimeLogger(mode)
})
