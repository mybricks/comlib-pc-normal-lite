import React, {useRef} from 'react'
import * as antd from "antd";
import {genAIRuntime} from './../utils/ai-code'
import echartsForReact from './../utils/echarts-for-react'
import {StyleProvider} from '@ant-design/cssinjs'
import {ConfigProvider} from "antd";
import zhCN from 'antd/locale/zh_CN'


export default genAIRuntime({
  title: 'AI',
  examples: [
    '创建一个后台数据看板，包含四个关键指标数据卡片，月度销售额趋势折线图，用户分布饼图',
    '生成一个标准的商品管理列表页，顶部提供搜索表单，下方是商品数据表格，包含查看和删除操作',
    '制作一个包含分步表单的注册页面',
    '实现一个企业通讯录页面，左侧是部门组织架构树，右侧是该部门下的员工详情列表，右上角提供添加员工按钮',
  ],
  dependencies: {
    antd,
    'echarts-for-react': echartsForReact,
    'antd/locale/zh_CN': zhCN,
    // '@dnd-kit/core': dndCore,
    // '@dnd-kit/modifiers': dndModifiers,
    // '@dnd-kit/sortable': dndSortable,
    // '@dnd-kit/utilities': dndUtilities
  },
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
})
