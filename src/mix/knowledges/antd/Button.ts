//每个区块都有内部的状态管理（data）

export default {
  description: `按钮组件`,
  editors: {
    ':root': {
      title: '按钮',
      items: [
        {
          type: '_resizer',
        },
      ],
      style: [
        {
          items: [
            {
              title: '样式',
              catelog: '默认',
              options: ['font', 'background', 'border', 'padding'],
            }
          ]
        }
      ]
    },
    '.ant-btn:not(:disabled):not(.ant-btn-disabled):hover': {
      title: '按钮悬浮态',
      style: [
        {
          items: [
            {
              title: '样式',
              catelog: '悬浮',
              options: ['background', 'font', 'border'],
            }
          ]
        }
      ]
    },
    '.ant-btn:focus-visible': {
      title: '按钮聚焦态',
      style: [
        {
          items: [
            {
              title: '样式',
              catelog: '聚焦',
              options: ['background', 'font', 'border', 'boxShadow'],
            }
          ]
        }
      ]
    },
    '.ant-btn:active': {
      title: '按钮激活态',
      style: [
        {
          items: [
            {
              title: '样式',
              catelog: '激活',
              options: ['background', 'font', 'border'],
            }
          ]
        }
      ]
    },
    '.ant-btn:disabled, .ant-btn.ant-btn-disabled': {
      title: '按钮禁用态',
      style: [
        {
          items: [
            {
              title: '样式',
              catelog: '禁用',
              options: ['background', 'font', 'border', 'opacity'],
            }
          ]
        }
      ]
    }
  },
  docs: `
通过设置 Button 的属性来产生不同的按钮样式，推荐顺序为：\`type\` -> \`shape\` -> \`size\` -> \`loading\` -> \`disabled\`。

按钮的属性说明如下：

| 属性 | 说明 | 类型 | 默认值 | 版本 |
| --- | --- | --- | --- | --- |
| autoInsertSpace | 我们默认提供两个汉字之间的空格，可以设置 \`autoInsertSpace\` 为 \`false\` 关闭 | boolean | \`true\` | 5.17.0 |
| block | 将按钮宽度调整为其父宽度的选项 | boolean | false |  |
| classNames | 语义化结构 class | [Record<SemanticDOM, string>](#semantic-dom) | - | 5.4.0 |
| color | 设置按钮的颜色 | \`default\` \\| \`primary\` \\| \`danger\` | - | 5.21.0 |
| danger | 语法糖，设置危险按钮。当设置 \`color\` 时会以后者为准 | boolean | false |  |
| disabled | 设置按钮失效状态 | boolean | false |  |
| ghost | 幽灵属性，使按钮背景透明 | boolean | false |  |
| href | 点击跳转的地址，指定此属性 button 的行为和 a 链接一致 | string | - |  |
| htmlType | 设置 \`button\` 原生的 \`type\` 值，可选值请参考 [HTML 标准](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Element/button#type) | \`submit\` \\| \`reset\` \\| \`button\` | \`button\` |  |
| icon | 设置按钮的图标组件 | ReactNode | - |  |
| iconPosition | 设置按钮图标组件的位置 | \`start\` \\| \`end\` | \`start\` | 5.17.0 |
| loading | 设置按钮载入状态 | boolean \\| { delay: number } | false |  |
| shape | 设置按钮形状 | \`default\` \\| \`circle\` \\| \`round\` | \`default\` |  |
| size | 设置按钮大小 | \`large\` \\| \`middle\` \\| \`small\` | \`middle\` |  |
| styles | 语义化结构 style | [Record<SemanticDOM, CSSProperties>](#semantic-dom) | - | 5.4.0 |
| target | 相当于 a 链接的 target 属性，href 存在时生效 | string | - |  |
| type | 语法糖，设置按钮类型。当设置 \`variant\` 与 \`color\` 时以后者为准 | \`primary\` \\| \`dashed\` \\| \`link\` \\| \`text\` \\| \`default\` | \`default\` |  |
| onClick | 点击按钮时的回调 | (event: React.MouseEvent<HTMLElement, MouseEvent>) => void | - |  |
| variant | 设置按钮的变体 | \`outlined\` \\| \`dashed\` \\| \`solid\` \\| \`filled\` \\| \`text\` \\| \`link\` | - | 5.21.0 |

支持原生 button 的其他所有属性。
  `,
}