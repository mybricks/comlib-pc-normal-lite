import { InputIds, OutputIds } from "./constants";
import { Schemas } from "./schema";
const version = ANTD_VERSION === 4 ? "" : "antd5."

export default {
  prompts: {
    summary: `数据表格 Table，支持分页、特殊列、自定义内容列。`,
    usage: `数据表格 Table，支持分页、特殊列、自定义内容列。
slots插槽
动态作用域插槽，当column的contentType为slotItem时，插槽id对应列的key值
插槽提供slotRowRecord输入用于读取行数据
表格行展开插槽，id为expandContent

layout声明
width: 可配置
height: 可配置，建议配置fit-content

使用步骤：
- 添加并确定列：
  - 配置「表格列」，并确定每一列的宽度和类型进行添加，对于不同的类型，继续以下流程：
    - 如果是自定义内容列，会添加对应列的key的插槽，插槽为空内容，先添加一个布局容器后，添加各种内容
      - 比如添加可点击文本，为可操作列
      - 比如添加表单项，为输入列
    - 如果是链接列，注意链接默认为蓝色
- 确定分页配置：开启后，UI默认在右下角展示分页器组件，从左到右包含「总结条数」「分页器」「每页条数下拉选择」「跳页器」；

- 确定是否包含固定列配置；
注意：无需关心dataSource，数据从输入项外部输入即可。
  `,
  },
  editors: {
    ':root': [
      {
        title: '常规/表格列',
        description: `通过数组来配置所有列
  [ # 表格列配置
    {
      key: string # 列唯一标识
      dataIndex: string
      title: string # 列标题
      width: string | number 
      isRowKey: boolean 
      contentType: ['text', 'link', 'slotItem'] # 列内容类型，默认为text
      fixed: 'left' | 'right' # 固定左边右边
    }
  ]
  `,
        type: 'array',
        value: {
          set: ({ data, slot, ...extra }, value) => {

            data.columns = value.map(t => ({
              ...t,
              visible: t.visible ?? true
            }))
            data.columns.forEach(col => {
              if (col.contentType === 'slotItem') {
                col.slotId = col.key;
                slot.add({ id: col.slotId, title: `${col.title}-列`, type: 'scope' })
              }
            })

            console.log('data.columns', data.columns)

          }
        }
      },
    ],
  },
}